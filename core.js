// Чиста логіка TargetMatch: без DOM, без рендерингу.
// У браузері підключається тегом <script> до app.js і стає window.TargetMatch.
// У Node (тести) підключається через require("../core.js").
// Залежить від глобальної змінної `mgrs` (той самий vendor/mgrs.min.js,
// який app.js уже підключає глобально) — у тестах її треба виставити
// вручну через global.mgrs перед require("../core.js").
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TargetMatch = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var INVALID_MGRS = "Невалідний MGRS";
  var INVALID_LATLON =
    "Невалідні WGS84-координати (широта -90..90, довгота -180..180)";
  var MAX_POI = 10;
  var EARTH_RADIUS_KM = 6371;

  // "47.180291, 15.110711" або "47.180291 15.110711" — широта, потім довгота.
  var LATLON_RE = /^(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/;

  function normalize(value) {
    return value.replace(/\s+/g, "").toUpperCase();
  }

  // Авто-визначення формату для одного рядка: MGRS чи WGS84 (широта, довгота).
  function convertOne(raw) {
    var trimmed = raw.trim();
    if (!trimmed) {
      return { ok: false, error: "Порожній рядок" };
    }

    var latLonMatch = trimmed.match(LATLON_RE);
    if (latLonMatch) {
      var lat = parseFloat(latLonMatch[1]);
      var lon = parseFloat(latLonMatch[2]);
      if (
        !isFinite(lat) ||
        !isFinite(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
      ) {
        return { ok: false, error: INVALID_LATLON };
      }
      try {
        var mgrsFromLatLon = mgrs.forward([lon, lat]);
        return {
          ok: true,
          mgrs: mgrsFromLatLon,
          lat: lat,
          lon: lon,
          source: "latlon"
        };
      } catch (err) {
        return { ok: false, error: INVALID_LATLON };
      }
    }

    var code = normalize(trimmed);
    try {
      var point = mgrs.toPoint(code);
      var pointLon = point[0];
      var pointLat = point[1];
      if (!isFinite(pointLat) || !isFinite(pointLon)) {
        return { ok: false, error: INVALID_MGRS };
      }
      return {
        ok: true,
        mgrs: code,
        lat: pointLat,
        lon: pointLon,
        source: "mgrs"
      };
    } catch (err) {
      return { ok: false, error: INVALID_MGRS };
    }
  }

  // Розбиває текст на рядки, пропускаючи порожні (і ті, що лише з пробілів).
  // Дублікати НЕ видаляються — кожен рядок вводу стає окремим елементом,
  // навіть якщо координата збігається з іншим рядком.
  function parseLines(text) {
    var lines = text.split(/\r?\n/);
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) {
        continue;
      }
      rows.push({ raw: raw, converted: convertOne(raw) });
    }
    return rows;
  }

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  // Відстань по дузі великого кола (Haversine), у кілометрах.
  function haversineKm(lat1, lon1, lat2, lon2) {
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
  }

  // Точки інтересу: бере перші maxCount розпізнаних рядків, решту (понад
  // ліміт) ігнорує повністю — навіть не перевіряє їх на валідність, тож
  // badRaws відображає лише помилки в межах урахованих рядків.
  function selectPoi(rows, maxCount) {
    var limit = typeof maxCount === "number" ? maxCount : MAX_POI;
    var considered = rows.slice(0, limit);
    var points = [];
    var badRaws = [];
    for (var i = 0; i < considered.length; i++) {
      if (considered[i].converted.ok) {
        points.push(considered[i].converted);
      } else {
        badRaws.push(considered[i].raw);
      }
    }
    return {
      points: points,
      badRaws: badRaws,
      consideredCount: considered.length,
      totalCount: rows.length
    };
  }

  // Перевіряє кожну ціль проти кожної точки інтересу.
  // Влучання = відстань <= radiusKm хоча б до однієї з точок (межа включно).
  // Невалідні рядки цілей потрапляють у badRaws і не впливають на інші рядки.
  function findHits(points, targetRows, radiusKm) {
    var hits = [];
    var badRaws = [];
    for (var i = 0; i < targetRows.length; i++) {
      var row = targetRows[i];
      if (!row.converted.ok) {
        badRaws.push(row.raw);
        continue;
      }
      var isHit = false;
      for (var j = 0; j < points.length; j++) {
        var distanceKm = haversineKm(
          row.converted.lat,
          row.converted.lon,
          points[j].lat,
          points[j].lon
        );
        if (distanceKm <= radiusKm) {
          isHit = true;
          break;
        }
      }
      if (isHit) {
        hits.push(row.converted);
      }
    }
    return { hits: hits, badRaws: badRaws };
  }

  return {
    INVALID_MGRS: INVALID_MGRS,
    INVALID_LATLON: INVALID_LATLON,
    MAX_POI: MAX_POI,
    EARTH_RADIUS_KM: EARTH_RADIUS_KM,
    normalize: normalize,
    convertOne: convertOne,
    parseLines: parseLines,
    haversineKm: haversineKm,
    selectPoi: selectPoi,
    findHits: findHits
  };
});
