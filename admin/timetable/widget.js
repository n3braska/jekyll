/*
 * Decap CMS widget "timetable": the normal object editor for one month, plus a panel that
 * fills it from the attached Word file (specs/J-1/spec.md §5.3). Needs parser.js.
 */
(function () {
  'use strict';

  var CMS = window.CMS;
  var h = window.h;
  var ObjectWidget = CMS.getWidget('object');

  var T = {
    fill: 'Заповнити з Word-файлу / Aus Word-Datei ausfüllen',
    attachFirst: 'Додайте Word-файл у полі «Word-файл» нижче, потім натисніть «Заповнити». / ' +
      'Word-Datei unten im Feld „Word-Datei“ anhängen, dann „Ausfüllen“ klicken.',
    pickLocal: 'або вибрати файл з комп’ютера (не зберігається) / oder Datei vom Computer wählen (wird nicht gespeichert)',
    busy: 'Читаю Word-файл… / Word-Datei wird gelesen…',
    overwrite: 'Замінити всі дні цього місяця даними з Word-файлу? / Alle Tage dieses Monats mit der Word-Datei überschreiben?',
    done: 'Заповнено. Перевірте попередження та дані перед збереженням. / Ausgefüllt. Bitte Hinweise und Daten vor dem Speichern prüfen.',
    noWarnings: 'Попереджень немає. / Keine Hinweise.',
    noMonth: 'Місяць не розпізнано, заповніть поле «Місяць» вручну. / Monat nicht erkannt, bitte Feld „Monat“ ausfüllen.',
    loadFailed: 'Не вдалося прочитати прикріплений файл. Виберіть його з комп’ютера. / ' +
      'Angehängte Datei konnte nicht gelesen werden. Bitte vom Computer wählen.'
  };

  var CHURCH_LABEL = { barbara: 'St. Barbara', jesuit: 'Jesuitenkirche' };

  // Decap passes Immutable values; build them with the constructors of the props we get.
  function toImmutable(value, MapC, ListC) {
    if (Array.isArray(value)) return ListC(value.map(function (v) { return toImmutable(v, MapC, ListC); }));
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (k) { out[k] = toImmutable(value[k], MapC, ListC); });
      return MapC(out);
    }
    return value;
  }

  function hasDays(value) {
    if (!value || !value.getIn) return false;
    return ['ua', 'de'].some(function (lang) {
      var days = value.getIn([lang, 'day']);
      return days && days.size > 0;
    });
  }

  function subField(field, name) {
    return field.get('fields').find(function (f) { return f.get('name') === name; });
  }

  var TimetableControl = window.createClass({
    getInitialState: function () {
      return { busy: false, error: null, result: null };
    },

    applyResult: function (result) {
      var props = this.props;
      var current = props.value && props.value.toJS ? props.value.toJS() : {};
      var data = result.data;
      var next = {
        month_date: data.month_date || current.month_date || '',
        source_docx: current.source_docx || '',
        ua: data.ua,
        de: data.de
      };
      // Keep a hand-written announcement when the Word file has no note for it
      var prefixes = window.TimetableParser.ANNOUNCEMENT_PREFIX;
      ['ua', 'de'].forEach(function (lang) {
        [['announcement', 'barbara'], ['announcement_jesuit', 'jesuit']].forEach(function (pair) {
          var old = current[lang] && current[lang][pair[0]];
          if (old && next[lang][pair[0]] === prefixes[lang][pair[1]]) next[lang][pair[0]] = old;
        });
      });
      var field = props.field;
      props.onChange(toImmutable(next, field.constructor, field.get('fields').constructor));
      this.setState({ busy: false, error: null, result: result });
    },

    parse: function (bufferPromise, fileName) {
      var self = this;
      if (hasDays(this.props.value) && !window.confirm(T.overwrite)) return;
      this.setState({ busy: true, error: null });
      bufferPromise
        .then(function (buffer) { return window.TimetableParser.parseDocx(buffer, { fileName: fileName }); })
        .then(function (result) { self.applyResult(result); })
        .catch(function (err) { self.setState({ busy: false, error: err.message || String(err) }); });
    },

    fillFromAttached: function () {
      var props = this.props;
      var path = props.value && props.value.get('source_docx');
      var docxField = subField(props.field, 'source_docx');
      var load = Promise.resolve(props.getAsset(path, docxField)).then(function (asset) {
        if (asset && asset.fileObj) return asset.fileObj.arrayBuffer();
        var url = asset && (asset.url || asset.toString());
        if (!url) throw new Error(T.loadFailed);
        return fetch(url).then(function (r) {
          if (!r.ok) throw new Error(T.loadFailed);
          return r.arrayBuffer();
        });
      }).catch(function () { throw new Error(T.loadFailed); });
      this.parse(load, path);
    },

    fillFromLocal: function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) this.parse(file.arrayBuffer(), file.name);
    },

    renderWarnings: function () {
      var result = this.state.result;
      if (!result) return null;
      var items = result.warnings;
      var children = [h('p', { key: 'done', style: { margin: '0 0 8px', fontWeight: 600 } }, T.done)];
      if (!result.data.month_date) children.push(h('p', { key: 'nomonth', style: { color: '#b00020', margin: '0 0 8px' } }, T.noMonth));
      if (!items.length) {
        children.push(h('p', { key: 'none', style: { margin: 0 } }, T.noWarnings));
      } else {
        children.push(h('ul', { key: 'list', style: { margin: 0, paddingLeft: '20px', maxHeight: '260px', overflowY: 'auto' } },
          items.map(function (w, i) {
            var where = [w.lang ? w.lang.toUpperCase() : null, w.church ? CHURCH_LABEL[w.church] : null, w.d ? 'd ' + w.d : null]
              .filter(Boolean).join(' · ');
            return h('li', { key: i, style: { color: w.level === 'warn' ? '#8a4b00' : '#555', marginBottom: '2px' } },
              (w.level === 'warn' ? '⚠ ' : 'ℹ ') + (where ? where + ': ' : '') + w.message);
          })));
      }
      return h('div', { style: { marginTop: '12px' } }, children);
    },

    render: function () {
      var value = this.props.value;
      var attached = value && value.get && value.get('source_docx');
      var self = this;
      var button = { padding: '8px 14px', borderRadius: '5px', border: 'none', background: '#3a69c7', color: '#fff', cursor: 'pointer', fontWeight: 600 };

      var panel = h('div', {
        style: { border: '1px solid #dfdfe3', borderRadius: '5px', padding: '14px', margin: '0 0 16px', background: '#f7f8fa' }
      },
        attached
          ? h('button', { type: 'button', style: button, disabled: this.state.busy, onClick: this.fillFromAttached }, T.fill)
          : h('p', { style: { margin: 0 } }, T.attachFirst),
        h('label', { style: { display: 'block', marginTop: '8px', fontSize: '13px', color: '#555', cursor: 'pointer' } },
          h('input', { type: 'file', accept: '.docx', style: { marginRight: '6px' }, onChange: this.fillFromLocal }),
          T.pickLocal),
        this.state.busy ? h('p', { style: { margin: '8px 0 0' } }, T.busy) : null,
        this.state.error ? h('p', { style: { margin: '8px 0 0', color: '#b00020' } }, this.state.error) : null,
        this.renderWarnings()
      );

      return h('div', null, panel, h(ObjectWidget.control, Object.assign({}, self.props)));
    }
  });

  CMS.registerWidget('timetable', TimetableControl, ObjectWidget.preview);
})();
