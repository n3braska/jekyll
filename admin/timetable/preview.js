/*
 * Decap CMS preview for the "timetable" collection: renders the month the same way as
 * _includes/timetable_church.html on the website (both languages, both churches).
 */
(function () {
  'use strict';

  var CMS = window.CMS;
  var h = window.h;

  ['/assets/css/bootstrap.min.css', '/assets/css/styless.css', '/assets/css/style4.css'].forEach(function (css) {
    CMS.registerPreviewStyle(css);
  });

  // _data/{ua,de}/months.yml → genetiv
  var MONTHS = {
    ua: ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
      'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'],
    de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
  };
  var HEADING = { ua: 'Розклад Богослужінь', de: 'Gottesdienstordnung' };

  function timetable(lang, data, monthIndex, wantJesuit) {
    var announcement = wantJesuit ? data.announcement_jesuit : data.announcement;
    var days = (data.day || []).map(function (entry) {
      var events = (entry.event || []).filter(function (e) { return !!e.isJesuitenKirche === wantJesuit; });
      if (!events.length) return null;
      return h('li', { key: entry.d, className: 'list-group-item' },
        h('div', { className: 'row cent' },
          h('div', { className: 'col-sm-2 atext-c center' }, entry.d + ' ' + (MONTHS[lang][monthIndex] || '')),
          h('div', { className: 'col-sm-10 atext-c center' },
            h('table', { style: { width: '100%' } }, h('tbody', null, events.map(function (e, i) {
              return h('tr', { key: i },
                h('td', { className: 'm-2 atext-c text-left', style: { width: '15%' } }, e.time),
                h('td', { className: 'm-2 atext-c align-middle', style: { width: '45%' } }, e.title),
                h('td', { className: 'm-2 atext-c align-middle', style: { width: '40%' } },
                  (e.occasion || []).map(function (note, n) { return h('div', { key: n }, note); })));
            }))))));
    }).filter(Boolean);

    return h('div', { className: 'timetable' },
      h('ul', { className: '' }, h('li', { className: '' }, announcement ? h('div', { className: 'row atext-c center' },
        h('span', { className: ' col-sm-2' }),
        h('div', { className: 'col-sm-8' }, announcement),
        h('span', { className: ' col-sm-2' })) : null)),
      h('ul', { className: 'list-group' }, days));
  }

  var TimetablePreview = window.createClass({
    render: function () {
      var month = this.props.entry.getIn(['data', 'month']);
      var data = month && month.toJS ? month.toJS() : {};
      var published = this.props.entry.getIn(['data', 'published']);
      var monthIndex = parseInt(String(data.month_date || '').slice(5, 7), 10) - 1;

      return h('div', { className: 'container mt-2 mb-5' },
        published === false
          ? h('p', { className: 'text-center text-muted pt-3' }, 'Не опубліковано / Nicht veröffentlicht')
          : null,
        ['ua', 'de'].map(function (lang) {
          var langData = data[lang] || {};
          return h('div', { key: lang, className: 'mb-5' },
            h('h3', { className: 'my-3 text-center title pt-3' }, HEADING[lang] + (data.month_date ? ' · ' + data.month_date : '')),
            h('div', null, timetable(lang, langData, monthIndex, true)),
            h('br'),
            h('div', null, timetable(lang, langData, monthIndex, false)));
        }));
    }
  });

  CMS.registerPreviewTemplate('timetable', TimetablePreview);
})();
