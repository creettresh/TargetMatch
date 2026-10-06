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

  // "47.180291, 15.110711", "47.180291 15.110711" або "47.180291; 15.110711"
  // — широта, потім довгота. Крапка з комою — той самий роздільник, що й
  // в extractCoordinateTokens() нижче, тож усе, що знаходить вільний
  // пошук, однаково успішно конвертується тут.
  var LATLON_RE = /^(-?\d{1,3}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)$/;

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

  // --- Вільний текст (для "Цілі противника") ---
  //
  // На відміну від parseLines (суворо "1 рядок = 1 координата"),
  // тут рядок може бути довільним текстом: "Харків - (33TWN0838825205)",
  // вставка з Excel/CSV колонкою чи через Tab, кілька координат в одному
  // рядку через кому/крапку з комою. Знаходимо координати ЯК ПІДРЯДКИ,
  // ігноруючи все навколо (назви міст, дужки, роздільники).
  //
  // WGS84-пара розпізнається лише з десятковою крапкою (47.1, 15.1) —
  // це і є межа, що відрізняє її від MGRS (там крапок не буває), тож
  // порядок пошуку (спочатку WGS84, потім MGRS на тому, що залишилось)
  // виключає плутанину між ними.
  var LATLON_TOKEN_RE =
    /-?\d{1,3}\.\d+(?:\s*[,;]\s*|\s+)-?\d{1,3}\.\d+/g;
  // Зона+смуга (1-2 цифри + 1 літера), квадрат (2 літери) і цифри easting/
  // northing — кожна межа між ними може мати (необов'язковий) пробіл, бо
  // так MGRS часто записують вручну: "37U CR 01497 41584". Друга група
  // цифр через ЛІТЕРАЛЬНИЙ пробіл (не "?") йде першою альтернативою —
  // інакше для суцільного запису "0149741584" двигун регулярних виразів
  // міг би зупинитись на першій половині цифр, щойно зустріне межу слова.
  //
  // НЕБЕЗПЕЧНА ПАСТКА, у яку сама і впала: якщо обмежити кожну з двох
  // груп цифр до {1,5} (бо "стандартний" запис — рівні половинки 5+5),
  // нерівний людський розподіл типу "0169 941807" (4+6) не влізе в жодну
  // альтернативу — і регулярка тихо "зловить" лише першу половину як
  // ОКРЕМИЙ, валідний, але ІНШИЙ (коротший і менш точний) MGRS, замість
  // явної помилки. Тому тут {1,9} — краще підхопити зайві цифри і дати
  // mgrs.toPoint() голосно відхилити це як невалідний MGRS, ніж тихо
  // повернути координату не там, де насправді ціль.
  var MGRS_TOKEN_RE =
    /\b\d{1,2}\s?[A-Za-z]\s?[A-Za-z]{2}\s?(?:\d{1,9}\s\d{1,9}|\d{2,10})\b/g;

  function findSpans(text, re) {
    var spans = [];
    var m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      spans.push({ raw: m[0], start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) {
        re.lastIndex++;
      }
    }
    return spans;
  }

  function maskSpans(text, spans) {
    var chars = text.split("");
    for (var i = 0; i < spans.length; i++) {
      for (var j = spans[i].start; j < spans[i].end; j++) {
        chars[j] = " ";
      }
    }
    return chars.join("");
  }

  // Повертає знайдені в рядку координати-підрядки, у порядку появи.
  function extractCoordinateTokens(line) {
    var latLonSpans = findSpans(line, LATLON_TOKEN_RE);
    var masked = maskSpans(line, latLonSpans);
    var mgrsSpans = findSpans(masked, MGRS_TOKEN_RE);
    var all = latLonSpans.concat(mgrsSpans);
    all.sort(function (a, b) {
      return a.start - b.start;
    });
    return all.map(function (span) {
      return span.raw;
    });
  }

  // Пояснення для рядка, що НЕ розпізнався як рівно одна координата
  // (використовується там, де формат суворий — "1 рядок = 1 координата",
  // тобто для точок інтересу). Перевикористовує той самий пошук підрядків,
  // що й parseFreeform, лише щоб поставити діагноз, а не щоб парсити.
  function explainUnrecognizedLine(raw) {
    var tokens = extractCoordinateTokens(raw);
    if (tokens.length >= 2) {
      return "кілька координат в одному рядку — кожну на свій рядок";
    }
    if (tokens.length === 1 && tokens[0] !== raw.trim()) {
      return "зайві символи навколо координати";
    }
    return "не розпізнано як MGRS чи WGS84";
  }

  // Як parseLines, але кожен рядок може містити 0, 1 чи кілька координат.
  // Рядок без жодної знайденої координати повністю йде в badRaws (через
  // converted.ok=false) — мовчки нічого не пропускаємо.
  function parseFreeform(text) {
    var lines = text.split(/\r?\n/);
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) {
        continue;
      }
      var tokens = extractCoordinateTokens(raw);
      if (!tokens.length) {
        rows.push({
          raw: raw,
          converted: { ok: false, error: "Координату не знайдено в рядку" }
        });
        continue;
      }
      for (var t = 0; t < tokens.length; t++) {
        rows.push({ raw: tokens[t], converted: convertOne(tokens[t]) });
      }
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
  //
  // badDetails — те саме, що й badRaws, але з причиною помилки з
  // convertOne() (INVALID_MGRS, INVALID_LATLON тощо) поряд з текстом.
  // badRaws лишається окремим полем (простий масив рядків) заради
  // зворотної сумісності — так його й перевіряють існуючі тести.
  function selectPoi(rows, maxCount) {
    var limit = typeof maxCount === "number" ? maxCount : MAX_POI;
    var considered = rows.slice(0, limit);
    var points = [];
    var badRaws = [];
    var badDetails = [];
    for (var i = 0; i < considered.length; i++) {
      if (considered[i].converted.ok) {
        points.push(considered[i].converted);
      } else {
        badRaws.push(considered[i].raw);
        badDetails.push({
          raw: considered[i].raw,
          error: considered[i].converted.error
        });
      }
    }
    return {
      points: points,
      badRaws: badRaws,
      badDetails: badDetails,
      consideredCount: considered.length,
      totalCount: rows.length
    };
  }

  // Перевіряє кожну ціль проти кожної точки інтересу.
  // Влучання = відстань <= radiusKm хоча б до однієї з точок (межа включно).
  // Невалідні рядки цілей потрапляють у badRaws і не впливають на інші рядки.
  // badDetails — як і в selectPoi, badRaws + причина помилки поряд.
  function findHits(points, targetRows, radiusKm) {
    var hits = [];
    var badRaws = [];
    var badDetails = [];
    for (var i = 0; i < targetRows.length; i++) {
      var row = targetRows[i];
      if (!row.converted.ok) {
        badRaws.push(row.raw);
        badDetails.push({ raw: row.raw, error: row.converted.error });
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
    return { hits: hits, badRaws: badRaws, badDetails: badDetails };
  }

  return {
    INVALID_MGRS: INVALID_MGRS,
    INVALID_LATLON: INVALID_LATLON,
    MAX_POI: MAX_POI,
    EARTH_RADIUS_KM: EARTH_RADIUS_KM,
    convertOne: convertOne,
    parseLines: parseLines,
    extractCoordinateTokens: extractCoordinateTokens,
    explainUnrecognizedLine: explainUnrecognizedLine,
    parseFreeform: parseFreeform,
    haversineKm: haversineKm,
    selectPoi: selectPoi,
    findHits: findHits
  };
});
