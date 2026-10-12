/*
 * Timetable Word (.docx) parser.
 * Converts the monthly parish timetable into the month data structure
 * described in specs/J-1/spec.md (§4 conversion rules, §5.4 data file).
 *
 * No dependencies: unzips with the browser's DecompressionStream and reads
 * word/document.xml with DOMParser. Exposed as window.TimetableParser.
 */
(function (global) {
  'use strict';

  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var LANGS = ['ua', 'de'];
  var CHURCHES = ['barbara', 'jesuit'];

  var MONTH_NAMES = {
    ua: ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень',
      'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'],
    de: ['januar', 'februar', 'märz', 'april', 'mai', 'juni',
      'juli', 'august', 'september', 'oktober', 'november', 'dezember']
  };

  // Index = Date.getDay()
  var WEEKDAYS = {
    ua: ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пятниця', 'субота'],
    de: ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag']
  };

  // Note line → language of the service. null = default language, no suffix.
  var LANGUAGES = {
    ua: {
      'українською': null, 'угорською': 'угорською', 'німецькою': 'німецькою',
      'словацькою': 'словацькою', 'англійською': 'англійською',
      'польською': 'польською', 'румунською': 'румунською'
    },
    de: {
      'ukrainisch': null, 'ungarisch': 'Ungarisch', 'deutsch': 'Deutsch',
      'slowakisch': 'Slowakisch', 'englisch': 'Englisch',
      'polnisch': 'Polnisch', 'rumänisch': 'Rumänisch'
    }
  };

  // Known typos in the source files (§4.5). Extend as needed.
  var TYPOS = {
    'угорськоью': 'угорською',
    'словацькоью': 'словацькою',
    'німецькоью': 'німецькою'
  };

  var JESUIT_MARKER = /єзуїт|jesuit/i;
  // The marker phrase itself; whatever remains is a note for the Jesuitenkirche day
  var JESUIT_PHRASE = /(українською\s+)?(у|в)\s+церкві\s+(отців\s+|о\.\s*)?єзуїтів|(in\s+der\s+|in\s+)?jesuitenkirche/i;
  var TITLE_STARTS = /\s+(?=Hl\. Liturgie|Служба Божа)/;
  var HEADER_LINE = /парафі|парох|сотрудник|pfarr|kaplan|тел\.|tel\./i;
  var TIME_RE = /(\d{1,2})[:.](\d{2})/g;

  var ANNOUNCEMENT_PREFIX = {
    ua: {
      barbara: 'У церкві св. Варвари: Postgasse 8A.',
      jesuit: 'У церкві отців Єзуїтів - Jesuitenkirche: Doktor-Ignaz-Seipel-Platz 1'
    },
    de: {
      barbara: 'In der Kirche St. Barbara: Postgasse 8A.',
      jesuit: 'In Jesuitenkirche: Doktor-Ignaz-Seipel-Platz 1'
    }
  };

  /* ---------- zip ---------- */

  async function readZipEntry(buffer, name) {
    var bytes = new Uint8Array(buffer);
    var view = new DataView(buffer);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a .docx (zip) file');
    var count = view.getUint16(eocd + 10, true);
    var ptr = view.getUint32(eocd + 16, true);
    var decoder = new TextDecoder();
    for (var n = 0; n < count; n++) {
      var method = view.getUint16(ptr + 10, true);
      var compSize = view.getUint32(ptr + 20, true);
      var nameLen = view.getUint16(ptr + 28, true);
      var extraLen = view.getUint16(ptr + 30, true);
      var commentLen = view.getUint16(ptr + 32, true);
      var localOffset = view.getUint32(ptr + 42, true);
      var entryName = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      if (entryName === name) {
        var localNameLen = view.getUint16(localOffset + 26, true);
        var localExtraLen = view.getUint16(localOffset + 28, true);
        var start = localOffset + 30 + localNameLen + localExtraLen;
        var data = bytes.subarray(start, start + compSize);
        if (method === 0) return decoder.decode(data);
        if (method !== 8) throw new Error('Unsupported zip compression method ' + method);
        var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return await new Response(stream).text();
      }
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error('Missing ' + name + ' in .docx');
  }

  /* ---------- text helpers ---------- */

  function clean(text) {
    return (text || '').replace(/[ \s]+/g, ' ').trim();
  }

  function fixTypos(text, warn) {
    return text.replace(/[^\s,.;:()«»„“"]+/g, function (word) {
      var fixed = TYPOS[word.toLowerCase()];
      if (!fixed) return word;
      warn('info', 'Fixed typo "' + word + '" → "' + fixed + '"');
      return fixed;
    });
  }

  function stripTrailingDot(text) {
    return /[^.]\.$/.test(text) ? text.slice(0, -1) : text;
  }

  // Cyrillic look-alikes in Latin words (e.g. "МÄRZ" typed with a Cyrillic М)
  function latinize(text) {
    var map = { 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O',
      'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'І': 'I', 'а': 'a', 'е': 'e', 'о': 'o',
      'р': 'p', 'с': 'c', 'х': 'x', 'і': 'i' };
    return text.replace(/[АВЕКМНОРСТХІаеорсхі]/g, function (c) { return map[c]; });
  }

  function normalizeWord(text) {
    return clean(text).toLowerCase().replace(/[’'ʼ`]/g, '');
  }

  function monthFromText(text) {
    var t = normalizeWord(text);
    var ua = MONTH_NAMES.ua.indexOf(t);
    if (ua >= 0) return ua + 1;
    var de = MONTH_NAMES.de.indexOf(normalizeWord(latinize(text)));
    return de >= 0 ? de + 1 : null;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- document.xml ---------- */

  function paragraphLines(p) {
    var text = '';
    var nodes = p.getElementsByTagNameNS(W_NS, '*');
    for (var i = 0; i < nodes.length; i++) {
      var ln = nodes[i].localName;
      if (ln === 't') text += nodes[i].textContent;
      else if (ln === 'tab') text += ' ';
      else if (ln === 'br' || ln === 'cr') text += '\n';
    }
    return text.split('\n');
  }

  function childrenNS(el, localName) {
    var out = [];
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.namespaceURI === W_NS && c.localName === localName) out.push(c);
    }
    return out;
  }

  function readCell(tc) {
    var lines = [];
    childrenNS(tc, 'p').forEach(function (p) { lines = lines.concat(paragraphLines(p)); });
    var span = 1;
    var vMerge = null;
    var pr = childrenNS(tc, 'tcPr')[0];
    if (pr) {
      var gs = childrenNS(pr, 'gridSpan')[0];
      if (gs) span = parseInt(gs.getAttributeNS(W_NS, 'val'), 10) || 1;
      var vm = childrenNS(pr, 'vMerge')[0];
      if (vm) vMerge = vm.getAttributeNS(W_NS, 'val') === 'restart' ? 'restart' : 'continue';
    }
    return { lines: lines.map(clean), span: span, vMerge: vMerge };
  }

  // Splits the body into [{paragraphs: [...text before table], rows: [[cells]]}]
  function readBody(xml) {
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    var body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
    var sections = [];
    var paragraphs = [];
    for (var el = body.firstElementChild; el; el = el.nextElementSibling) {
      if (el.localName === 'p') {
        var t = clean(paragraphLines(el).join(' '));
        if (t) paragraphs.push(t);
      } else if (el.localName === 'tbl') {
        var rows = childrenNS(el, 'tr').map(function (tr) {
          var col = 0;
          return childrenNS(tr, 'tc').map(function (tc) {
            var cell = readCell(tc);
            cell.col = col;
            col += cell.span;
            return cell;
          });
        });
        sections.push({ paragraphs: paragraphs, rows: rows });
        paragraphs = [];
      }
    }
    return sections;
  }

  /* ---------- table → day blocks ---------- */

  var ROLE_BY_COL = ['day', 'weekday', 'times', 'titles', 'notes'];

  function tableToBlocks(rows, warn) {
    var blocks = [];
    var monthNotes = [];
    var current = null;

    rows.forEach(function (cells, rowIndex) {
      var nonEmpty = cells.filter(function (c) { return c.lines.join('').trim(); });
      // Full-width row: month-level note (Q10)
      if (cells.length === 1 || (cells[0] && cells[0].col === 0 && cells[0].span >= 4)) {
        var text = clean(cells.map(function (c) { return c.lines.join(' '); }).join(' '));
        if (text) {
          monthNotes.push(text);
          warn('info', 'Row ' + (rowIndex + 1) + ' spans the whole table; added to the announcement: "' + text + '"');
        }
        return;
      }

      var row = { weekday: [], times: [], titles: [], notes: [], wide: [] };
      var dayCell = null;
      cells.forEach(function (cell) {
        if (cell.col >= 2 && cell.span >= 3) {
          row.wide = row.wide.concat(cell.lines.filter(Boolean));
          return;
        }
        var role = ROLE_BY_COL[cell.col];
        if (role === 'day') dayCell = cell;
        else if (role) row[role] = cell.lines;
      });

      var dayMatch = dayCell && dayCell.vMerge !== 'continue' && dayCell.lines.join(' ').match(/\d{1,2}/);
      if (dayMatch) {
        current = { d: parseInt(dayMatch[0], 10), rows: [] };
        blocks.push(current);
      } else if (!(dayCell && dayCell.vMerge === 'continue') || !current) {
        if (nonEmpty.length) {
          warn('warn', 'Row ' + (rowIndex + 1) + ' has no day number and was skipped: "' +
            clean(cells.map(function (c) { return c.lines.join(' '); }).join(' | ')) + '"');
        }
        return;
      }
      current.rows.push(row);
    });

    return { blocks: blocks, monthNotes: monthNotes };
  }

  /* ---------- day block → services ---------- */

  function parseWeekdayCell(lines, lang) {
    var weekday = null;
    var feasts = [];
    lines.filter(Boolean).forEach(function (line) {
      var norm = normalizeWord(line);
      var idx = -1;
      WEEKDAYS[lang].forEach(function (name, i) {
        if (idx < 0 && norm.indexOf(name) === 0) idx = i;
      });
      if (idx >= 0 && weekday === null) {
        weekday = idx;
        // Length of the weekday word in the original line (apostrophes are dropped by normalizeWord)
        var m = line.match(/^\s*[^\s.,:;–-]+/);
        var rest = line.slice(m ? m[0].length : 0);
        if (!clean(rest)) return;
        if (/^\s*[.,:;–-]/.test(rest)) feasts.push(clean(rest.replace(/^\s*[.,:;–-]+/, '')));
        else feasts.push(clean(line));
      } else {
        feasts.push(clean(line));
      }
    });
    return { weekday: weekday, feasts: feasts.filter(Boolean) };
  }

  function expandTimes(lines, warn) {
    var out = [];
    lines.forEach(function (line) {
      var matches = [];
      var m;
      TIME_RE.lastIndex = 0;
      while ((m = TIME_RE.exec(line))) matches.push(pad2(parseInt(m[1], 10)) + ':' + m[2]);
      if (!matches.length) {
        if (line) warn('warn', 'Not a time: "' + line + '"');
        out.push('');
      } else {
        out = out.concat(matches);
      }
    });
    return out;
  }

  function expandTitles(lines) {
    var out = [];
    lines.forEach(function (line) {
      var parts = line.split(TITLE_STARTS).map(clean).filter(Boolean);
      out = out.concat(parts.length > 1 ? parts : [line]);
    });
    return out;
  }

  function trimEmptyTail(list) {
    var l = list.slice();
    while (l.length && !l[l.length - 1]) l.pop();
    return l;
  }

  // A title ending like this continues on the next line ("Служба Божа та | Велике Водосвяття")
  var CONTINUES = /(\s(та|і|й|und|and)|[,–-])$/i;

  // Pairs the times and titles cells of one row (§4.2, Q4–Q6).
  // Returns services with `raw` = index of their line in the times cell, and
  // headings = titles without a time that describe the whole day.
  function pairServices(row, warn) {
    var allTimes = trimEmptyTail(expandTimes(row.times, warn));
    var times = allTimes;
    var titles = trimEmptyTail(expandTitles(row.titles));
    var services = [];
    var headings = [];
    var offset = 0;

    // Leading title without a time while the counts differ → heading ("Довга ніч церков")
    while (times.length !== titles.length && times[0] === '' && titles[0]) {
      headings.push(titles[0]);
      times = times.slice(1);
      titles = titles.slice(1);
      offset++;
    }

    if (times.length === titles.length) {
      times.forEach(function (t, i) {
        var title = titles[i];
        var prev = services[services.length - 1];
        if (!t && title && prev && CONTINUES.test(prev.title)) {
          prev.title = clean(prev.title + ' ' + title);
        } else if (!t && title && !services.length && times.slice(i + 1).some(Boolean)) {
          headings.push(title);
        } else {
          services.push({ time: t, title: title, raw: i + offset });
        }
      });
    } else {
      var ct = [];
      times.forEach(function (t, i) { if (t) ct.push({ time: t, raw: i + offset }); });
      var cl = titles.filter(Boolean);
      if (ct.length === 1 && cl.length > 1) {
        warn('info', 'One time for ' + cl.length + ' titles; ' + ct[0].time + ' used for all of them');
        cl.forEach(function (title) { services.push({ time: ct[0].time, title: title, raw: ct[0].raw }); });
      } else if (cl.length === 1 && ct.length > 1) {
        warn('info', 'One title for ' + ct.length + ' times; "' + cl[0] + '" used for all of them');
        ct.forEach(function (t) { services.push({ time: t.time, title: cl[0], raw: t.raw }); });
      } else {
        if (ct.length !== cl.length) {
          warn('warn', ct.length + ' time(s) but ' + cl.length + ' title(s); please check this day');
        }
        for (var i = 0; i < Math.max(ct.length, cl.length); i++) {
          services.push({
            time: ct[i] ? ct[i].time : '',
            title: cl[i] || '',
            raw: ct[i] ? ct[i].raw : allTimes.length + i
          });
        }
      }
    }
    if (headings.length) warn('info', 'Line without a time treated as a note for the day: "' + headings.join('", "') + '"');
    services = services.filter(function (s) { return s.time || s.title; });
    services.forEach(function (s, i) { s.index = i; });
    return { services: services, headings: headings, rawCount: allTimes.length };
  }

  function classifyNote(note, lang) {
    if (JESUIT_MARKER.test(note)) return { kind: 'jesuit' };
    var key = normalizeWord(note).replace(/(^|\s)(мовою|sprache)(?=\s|$)/g, ' ').replace(/[().,;:]/g, '').trim();
    if (Object.prototype.hasOwnProperty.call(LANGUAGES[lang], key)) {
      return { kind: 'language', language: LANGUAGES[lang][key] };
    }
    return { kind: 'note' };
  }

  // Notes sometimes start a line too high (missing empty first line). If the Jesuitenkirche
  // marker points at another service while a 12:30 service follows, shift all notes down.
  function noteShift(notes, paired, lang) {
    var marker = -1;
    notes.forEach(function (n, i) { if (marker < 0 && n && classifyNote(n, lang).kind === 'jesuit') marker = i; });
    if (marker < 0) return 0;
    var at1230 = paired.services.filter(function (s) { return s.time === '12:30'; })[0];
    if (!at1230 || at1230.raw <= marker) return 0;
    var shift = at1230.raw - marker;
    return notes.length + shift <= paired.rawCount ? shift : 0;
  }

  function applyLanguage(title, language, lang) {
    if (!language) return title;
    if (lang === 'ua') {
      return title.toLowerCase().indexOf(language) >= 0 ? title : title + ' ' + language;
    }
    return /\(/.test(title) ? title : title + ' (' + language + ')';
  }

  function normalizeTitle(title, lang) {
    // Ukrainian is the default language: "Hl. Liturgie (Ukrainisch)" → "Hl. Liturgie"
    if (lang === 'de') title = title.replace(/\s*\(ukrainisch\)/i, '');
    return clean(title);
  }

  function buildDay(block, lang, warn) {
    var dayWarn = function (level, msg) { warn(level, msg, block.d); };
    var weekdayLines = [];
    var wide = [];
    var services = [];
    var noteEntries = [];
    var headingNotes = [];

    block.rows.forEach(function (row) {
      weekdayLines = weekdayLines.concat(row.weekday);
      wide = wide.concat(row.wide);
      if (!row.times.join('') && !row.titles.join('')) {
        row.notes.filter(Boolean).forEach(function (n) { noteEntries.push({ text: n, service: null }); });
        return;
      }
      var paired = pairServices(row, dayWarn);
      headingNotes = headingNotes.concat(paired.headings);
      var offset = services.length;
      // Note line i belongs to time line i; notes may stop early but must not outnumber the times
      var notes = trimEmptyTail(row.notes);
      var shift = noteShift(notes, paired, lang);
      if (shift) {
        dayWarn('info', 'Notes start ' + shift + ' line(s) too high; shifted to line up with the 12:30 Jesuitenkirche service');
        notes = new Array(shift).fill('').concat(notes);
      }
      var aligned = notes.length <= paired.rawCount;
      notes.forEach(function (n, i) {
        if (!n) return;
        var target = paired.services.filter(function (s) { return s.raw === i; })[0] || null;
        noteEntries.push({ text: n, service: target ? offset + target.index : null, aligned: aligned });
      });
      services = services.concat(paired.services.map(function (s) { return { time: s.time, title: s.title }; }));
    });

    var wd = parseWeekdayCell(weekdayLines, lang);
    var jesuitIdx = {};
    var notesFor = services.map(function () { return []; });
    var looseNotes = [];

    noteEntries.forEach(function (entry) {
      var text = stripTrailingDot(fixTypos(clean(entry.text), dayWarn));
      var kind = classifyNote(text, lang);
      if (kind.kind === 'jesuit') {
        var idx = entry.service;
        if (idx === null || !entry.aligned) {
          var at1230 = services.map(function (s) { return s.time; }).indexOf('12:30');
          idx = at1230 >= 0 ? at1230 : null;
          dayWarn('warn', 'Jesuitenkirche note does not line up with a service; ' +
            (at1230 >= 0 ? 'used the 12:30 service' : 'no service assigned'));
        }
        if (idx !== null) jesuitIdx[idx] = true;
        // "ПЕРШЕ ПРИЧАСТЯ в церкві о. Єзуїтів" → note "ПЕРШЕ ПРИЧАСТЯ" for that service
        var rest = clean(text.replace(JESUIT_PHRASE, '').replace(/^[\s,.;:–-]+|[\s,;:–-]+$/g, ''));
        if (rest && classifyNote(rest, lang).kind !== 'language') (idx !== null ? notesFor[idx] : looseNotes).push(rest);
      } else if (kind.kind === 'language') {
        if (entry.service === null) dayWarn('warn', 'Language note "' + text + '" does not line up with a service');
        else services[entry.service].title = applyLanguage(services[entry.service].title, kind.language, lang);
      } else if (entry.service !== null && entry.aligned) {
        notesFor[entry.service].push(text);
      } else {
        looseNotes.push(text);
      }
    });

    var events = services.map(function (s, i) {
      var title = normalizeTitle(fixTypos(s.title, dayWarn), lang);
      if (!s.time) dayWarn('warn', 'Service "' + title + '" has no time');
      if (!title) dayWarn('warn', 'Service at ' + s.time + ' has no title');
      return { time: s.time, title: title, occasion: notesFor[i], isJesuitenKirche: !!jesuitIdx[i] };
    });

    // Notes for the whole day (§4.4): feast name → the Jesuitenkirche service if there is one,
    // otherwise the first service; other day notes → the first St. Barbara service.
    var feasts = wd.feasts.map(function (f) { return stripTrailingDot(fixTypos(f, dayWarn)); });
    var dayNotes = wide.concat(headingNotes).map(function (w) { return stripTrailingDot(fixTypos(clean(w), dayWarn)); })
      .concat(looseNotes);
    if (!events.length && (feasts.length || dayNotes.length)) {
      dayWarn('warn', 'Notes without a service; added as an entry without time');
      events.push({ time: '', title: '', occasion: [], isJesuitenKirche: false });
    }
    if (!events.length) return { day: null, weekday: wd.weekday };
    var jesuitEvent = events.filter(function (e) { return e.isJesuitenKirche; })[0];
    var barbaraEvent = events.filter(function (e) { return !e.isJesuitenKirche; })[0] || events[0];
    barbaraEvent.occasion = dayNotes.concat(barbaraEvent.occasion);
    var feastEvent = jesuitEvent || events[0];
    feastEvent.occasion = feasts.concat(feastEvent.occasion);

    return { day: { d: block.d, event: events }, weekday: wd.weekday };
  }

  /* ---------- month / year detection ---------- */

  function detectHeading(paragraphs) {
    for (var i = 0; i < paragraphs.length; i++) {
      var m = monthFromText(paragraphs[i]);
      if (m) return { month: m, index: i };
    }
    return null;
  }

  function monthFromFileName(fileName) {
    var base = (fileName || '').replace(/^.*[\\/]/, '').replace(/\.docx$/i, '');
    var lower = normalizeWord(base);
    var found = null;
    MONTH_NAMES.ua.forEach(function (name, i) {
      if (!found && lower.indexOf(name) >= 0) found = i + 1;
    });
    if (!found) {
      var num = base.match(/^\s*(\d{1,2})(?!\d)/) || base.match(/(?:^|\D)(\d{4})-(\d{2})(?:\D|$)/);
      if (num) {
        var n = parseInt(num[2] || num[1], 10);
        if (n >= 1 && n <= 12) found = n;
      }
    }
    var year = base.match(/(20\d\d)/);
    return { month: found, year: year ? parseInt(year[1], 10) : null };
  }

  function detectYear(month, checks, refYear) {
    var candidates = [refYear, refYear + 1, refYear - 1, refYear + 2, refYear - 2];
    var best = null;
    candidates.forEach(function (y) {
      var ok = 0;
      checks.forEach(function (c) {
        if (new Date(y, month - 1, c.d).getDay() === c.weekday) ok++;
      });
      if (!best || ok > best.ok) best = { year: y, ok: ok };
    });
    return { year: best.year, matched: best.ok, total: checks.length };
  }

  /* ---------- cross-language check (§4.7) ---------- */

  function compareLanguages(data, warn) {
    CHURCHES.forEach(function (church) {
      var wantJesuit = church === 'jesuit';
      function byDay(lang) {
        var out = {};
        data[lang].day.forEach(function (d) {
          var events = d.event.filter(function (e) { return e.isJesuitenKirche === wantJesuit; });
          if (events.length) out[d.d] = events;
        });
        return out;
      }
      var ua = byDay('ua'), de = byDay('de');
      var all = Object.keys(ua).concat(Object.keys(de).filter(function (k) { return !ua[k]; }))
        .map(Number).sort(function (a, b) { return a - b; });
      all.forEach(function (d) {
        var u = ua[d], g = de[d];
        if (!u || !g) {
          warn('warn', 'Day ' + d + ' exists only in the ' + (u ? 'UA' : 'DE') + ' table', d, church);
          return;
        }
        if (u.length !== g.length) {
          warn('warn', 'UA has ' + u.length + ' service(s), DE has ' + g.length, d, church);
          return;
        }
        u.forEach(function (e, i) {
          if (e.time !== g[i].time) {
            warn('warn', 'Service ' + (i + 1) + ': UA ' + (e.time || '—') + ', DE ' + (g[i].time || '—'), d, church);
          }
        });
      });
    });
  }

  /* ---------- main ---------- */

  function emptyMonth() {
    var m = {};
    LANGS.forEach(function (lang) {
      m[lang] = {
        announcement: ANNOUNCEMENT_PREFIX[lang].barbara,
        announcement_jesuit: ANNOUNCEMENT_PREFIX[lang].jesuit,
        day: []
      };
    });
    return m;
  }

  function announcementNotes(paragraphs, heading) {
    var lines = heading ? paragraphs.slice(heading.index + 1)
      : paragraphs.filter(function (p) { return !HEADER_LINE.test(p); });
    return lines.map(function (l) { return /[.!?]$/.test(l) ? l : l + '.'; });
  }

  /**
   * @param {string} xml   word/document.xml
   * @param {object} opts  { fileName, month (1-12, override), year (override), today (Date) }
   * @returns {{ data: object, warnings: Array, meta: object }}
   */
  function parseDocumentXml(xml, opts) {
    opts = opts || {};
    var warnings = [];
    var sections = readBody(xml);
    var data = emptyMonth();
    var warnFor = function (lang, church) {
      return function (level, message, d) {
        warnings.push({ level: level, lang: lang, church: church || null, d: d || null, message: message });
      };
    };
    var general = warnFor(null);

    if (sections.length !== 2) {
      general('warn', 'Expected 2 tables (UA, DE) but found ' + sections.length +
        (sections.length > 2 ? '; only the first two are used' : ''));
    }

    var headings = {};
    var weekdayChecks = [];
    LANGS.forEach(function (lang, i) {
      var section = sections[i];
      if (!section) return;
      var warn = warnFor(lang);
      var heading = detectHeading(section.paragraphs);
      if (heading) headings[lang] = heading.month;
      var parsed = tableToBlocks(section.rows, warn);
      var notes = announcementNotes(section.paragraphs, heading).concat(parsed.monthNotes);
      if (notes.length) {
        data[lang].announcement = [ANNOUNCEMENT_PREFIX[lang].barbara].concat(notes).join(' ');
      }

      var seen = {};
      var days = data[lang].day;
      parsed.blocks.forEach(function (block) {
        var built = buildDay(block, lang, warn);
        if (built.weekday !== null) weekdayChecks.push({ d: block.d, weekday: built.weekday, lang: lang });
        if (!built.day) return;
        if (seen[block.d]) {
          warn('warn', 'Day ' + block.d + ' appears more than once; merged', block.d);
          seen[block.d].event = seen[block.d].event.concat(built.day.event);
        } else {
          seen[block.d] = built.day;
          days.push(built.day);
        }
      });
      for (var k = 1; k < days.length; k++) {
        if (days[k].d < days[k - 1].d) {
          warn('warn', 'Days are not in order (' + days[k - 1].d + ' before ' + days[k].d + '); sorted');
          break;
        }
      }
      days.sort(function (a, b) { return a.d - b.d; });
    });

    // Month
    var fromFile = monthFromFileName(opts.fileName);
    var month = opts.month || headings.ua || headings.de || fromFile.month || null;
    if (headings.ua && headings.de && headings.ua !== headings.de) {
      general('warn', 'UA heading says month ' + headings.ua + ', DE heading says ' + headings.de + '; using UA');
    }
    if (!opts.month && !headings.ua && !headings.de) {
      general(fromFile.month ? 'info' : 'warn', fromFile.month
        ? 'No month heading in the document; month taken from the file name'
        : 'Month could not be detected; please choose it');
    }

    // Year
    var today = opts.today || new Date();
    var year = opts.year || null;
    if (month && !year) {
      var detected = detectYear(month, weekdayChecks, fromFile.year || today.getFullYear());
      year = detected.year;
      if (detected.total && detected.matched < detected.total) {
        general('warn', 'Only ' + detected.matched + ' of ' + detected.total +
          ' weekdays match ' + MONTH_NAMES.de[month - 1] + ' ' + year + '; please check month and year');
      }
    }
    if (month && year) {
      var daysInMonth = new Date(year, month, 0).getDate();
      weekdayChecks.forEach(function (c) {
        if (c.d > daysInMonth) warnFor(c.lang)('warn', 'Day ' + c.d + ' does not exist in this month', c.d);
        else if (new Date(year, month - 1, c.d).getDay() !== c.weekday) {
          warnFor(c.lang)('warn', 'Weekday does not match the date', c.d);
        }
      });
    }

    if (sections.length >= 2) {
      compareLanguages(data, function (level, message, d, church) {
        warnings.push({ level: level, lang: 'ua/de', church: church, d: d, message: message });
      });
    }

    var result = {};
    if (month && year) result.month_date = year + '-' + pad2(month);
    result.ua = data.ua;
    result.de = data.de;
    return {
      data: result,
      warnings: warnings,
      meta: { month: month, year: year, tables: sections.length }
    };
  }

  async function parseDocx(buffer, opts) {
    var xml = await readZipEntry(buffer, 'word/document.xml');
    return parseDocumentXml(xml, opts);
  }

  var api = {
    parseDocx: parseDocx,
    parseDocumentXml: parseDocumentXml,
    readZipEntry: readZipEntry,
    ANNOUNCEMENT_PREFIX: ANNOUNCEMENT_PREFIX
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.TimetableParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
