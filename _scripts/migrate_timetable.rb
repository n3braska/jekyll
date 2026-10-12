# One-time migration of the old 12-slot calendars into one file per month.
# See specs/J-1/spec.md §5.6.
#
#   ruby _scripts/migrate_timetable.rb           # dry run, prints the report
#   ruby _scripts/migrate_timetable.rb --write   # writes _data/timetable/YYYY-MM.yml
#
# The old files were removed after the migration; they are read from git at SOURCE_COMMIT.
#
# The old files carry no reliable year (month_date is stale), so each slot is dated by
# checking on which days of candidate months its Sunday services fall. Slots that can't
# be dated with confidence, or that are older than MIN_YEAR, are dropped.

require 'yaml'
require 'json'
require 'date'
require 'fileutils'
require 'open3'

ROOT = File.expand_path('..', __dir__)
OUT_DIR = File.join(ROOT, '_data', 'timetable')
MIN_YEAR = 2026
YEARS = (2023..Date.today.year).freeze # the old data can't be from a future year
CHURCH_FILES = { 'barbara' => 'josaphatskapelle', 'jesuit' => 'jesuitenkirche' }.freeze
LANGS = %w[ua de].freeze
SOURCE_COMMIT = 'c126b87' # last commit with the old calendar files

def load_old(path)
  out, status = Open3.capture2('git', '-C', ROOT, 'show', "#{SOURCE_COMMIT}:#{path}")
  abort "Cannot read #{path} at #{SOURCE_COMMIT}" unless status.success?
  YAML.safe_load(out)
end

def load_slots
  LANGS.each_with_object({}) do |lang, acc|
    CHURCH_FILES.each do |church, file|
      acc[[lang, church]] = load_old("_data/#{lang}/calendar_#{file}.yml")['month']
    end
  end
end

# Days that are almost certainly Sundays: Jesuitenkirche services and days with 3+ services
def sunday_like_days(cal, slot)
  days = []
  LANGS.each do |lang|
    (cal[[lang, 'jesuit']][slot]['day'] || []).each { |d| days << d['d'].to_i }
    (cal[[lang, 'barbara']][slot]['day'] || []).each { |d| days << d['d'].to_i if (d['event'] || []).size >= 3 }
  end
  days.uniq
end

def date_slot(cal, slot)
  days = sunday_like_days(cal, slot)
  return nil if days.size < 2

  # The slot's own month first; neighbouring months only if that fails (data was
  # sometimes written into the wrong slot, e.g. July 2026 into the August slot).
  natural = slot + 1
  [[natural], [natural - 1, natural + 1]].each do |months|
    candidates = months.select { |m| m.between?(1, 12) }.product(YEARS.to_a)
    scored = candidates.map do |month, year|
      ok = days.count { |d| Date.valid_date?(year, month, d) && Date.new(year, month, d).sunday? }
      { month: month, year: year, ok: ok, natural: month == natural }
    end
    best = scored.max_by { |s| s[:ok] }
    next if best[:ok] < 2 || best[:ok] < (days.size * 0.6).ceil
    next if scored.count { |s| s[:ok] == best[:ok] } > 1

    return best.merge(total: days.size)
  end
  nil
end

def clean_time(time)
  time.to_s.strip
end

LANGUAGE_SUFFIX = /\A(угорською|німецькою|словацькою|англійською|польською|румунською|Ungarisch|Deutsch|Slowakisch|Englisch|Polnisch|Rumänisch)\z/i.freeze

# "Служба Божа (Поминання померлих)" → title "Служба Божа" + note; "Служба Божа (угорською)" →
# "Служба Божа угорською"; "Hl. Liturgie (Ungarisch)" stays as it is (same as the importer).
def split_title(title)
  m = title.match(/\A(.+?)\s*\((.+)\)\z/)
  return [title, nil] unless m
  return [title, nil] if m[2] =~ LANGUAGE_SUFFIX && m[2] =~ /\A[A-Z]/
  return ["#{m[1]} #{m[2]}", nil] if m[2] =~ LANGUAGE_SUFFIX

  [m[1], m[2]]
end

# One old day of one church → services with their own notes and the church flag.
# The day's note goes to the first service (the importer does the same).
def convert_events(day, jesuit)
  events = (day['event'] || []).map do |e|
    title, note = split_title(e['title'].to_s.strip)
    notes = []
    notes << note if note
    notes << e['occasion'].to_s.strip unless e['occasion'].to_s.strip.empty?
    { 'time' => clean_time(e['time']), 'title' => title, 'occasion' => notes, 'isJesuitenKirche' => jesuit }
  end
  day_note = day['occasion'].to_s.strip
  unless day_note.empty?
    events << { 'time' => '', 'title' => '', 'occasion' => [], 'isJesuitenKirche' => jesuit } if events.empty?
    events.first['occasion'].unshift(day_note) unless events.first['occasion'].include?(day_note)
  end
  events
end

def convert_slot(cal, slot)
  LANGS.each_with_object({}) do |lang, out|
    barbara = cal[[lang, 'barbara']][slot]
    jesuit = cal[[lang, 'jesuit']][slot]
    days = Hash.new { |h, d| h[d] = [] }
    (barbara['day'] || []).each { |d| days[d['d'].to_i].concat(convert_events(d, false)) }
    (jesuit['day'] || []).each { |d| days[d['d'].to_i].concat(convert_events(d, true)) }
    out[lang] = {
      'announcement' => barbara['announcement'].to_s.strip,
      'announcement_jesuit' => jesuit['announcement'].to_s.strip,
      'day' => days.keys.sort.map do |d|
        # services in time order; entries without a time keep their place at the end
        { 'd' => d, 'event' => days[d].each_with_index.sort_by { |e, i| [e['time'].empty? ? 1 : 0, e['time'], i] }.map(&:first) }
      end
    }
  end
end

# Small emitter so every file has the same, CMS-like layout with all strings quoted.
def emit(value, indent = 0)
  pad = ' ' * indent
  case value
  when Hash
    value.map do |k, v|
      if (v.is_a?(Hash) && !v.empty?) || (v.is_a?(Array) && !v.empty?)
        "#{pad}#{k}:\n#{emit(v, indent + 2)}"
      else
        "#{pad}#{k}: #{scalar(v)}\n"
      end
    end.join
  when Array
    value.map do |item|
      if item.is_a?(Hash) && !item.empty?
        lines = emit(item, indent + 2)
        "#{pad}- #{lines.sub(/\A\s+/, '')}"
      else
        "#{pad}- #{scalar(item)}\n"
      end
    end.join
  end
end

def scalar(v)
  case v
  when Hash then '{}'
  when Array then '[]'
  when Integer, TrueClass, FalseClass then v.to_s
  when nil then '""'
  else JSON.generate(v.to_s)
  end
end

cal = load_slots
published = load_old('_data/publishedMonths.yml')['month']
                .each_with_object({}) { |m, h| h[m['number']] = m['isPublished'] }

results = {}
report = []
12.times do |slot|
  dated = date_slot(cal, slot)
  if dated.nil?
    report << "slot #{slot} (month #{slot + 1}): DROPPED, could not be dated"
    next
  end
  key = format('%04d-%02d', dated[:year], dated[:month])
  note = "#{dated[:ok]}/#{dated[:total]} Sunday-like days match"
  note += ", NOT the slot's own month" unless dated[:natural]
  if dated[:year] < MIN_YEAR
    report << "slot #{slot} (month #{slot + 1}): #{key} (#{note}) DROPPED, before #{MIN_YEAR}"
    next
  end
  if results[key]
    report << "slot #{slot} (month #{slot + 1}): #{key} (#{note}) DROPPED, #{key} already taken by slot #{results[key][:slot]}"
    next
  end
  results[key] = { slot: slot, data: convert_slot(cal, slot) }
  report << "slot #{slot} (month #{slot + 1}): #{key} (#{note}), published: #{published[slot] ? 'yes' : 'no'}"
end

puts report
puts

if ARGV.include?('--write')
  FileUtils.mkdir_p(OUT_DIR)
  results.sort.each do |key, r|
    month = { 'month_date' => key }
    docx = "/assets/timetables/#{key}.docx"
    month['source_docx'] = docx if File.exist?(File.join(ROOT, docx))
    month.merge!(r[:data])
    doc = { 'published' => published[r[:slot]] ? true : false, 'month' => month }
    path = File.join(OUT_DIR, "#{key}.yml")
    File.write(path, emit(doc))
    puts "wrote #{path.sub(ROOT + '/', '')}"
  end
else
  puts "Dry run. #{results.size} month(s) would be written; pass --write to write them."
end
