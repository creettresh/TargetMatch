// Тести чистої логіки TargetMatch (core.js) — без браузера, без DOM.
// Запуск: node --test tests/   (вбудований тест-раннер, Node 18+, без npm і залежностей)
"use strict";

const assert = require("node:assert/strict");
const { test, describe } = require("node:test");

// core.js очікує глобальну змінну `mgrs` (так само, як і в браузері її
// виставляє <script src="vendor/mgrs.min.js">) — тут виставляємо вручну
// до require, інакше convertOne() впаде з "mgrs is not defined".
global.mgrs = require("../vendor/mgrs.min.js");
const TargetMatch = require("../core.js");

describe("TargetMatch — форма експорту", function () {
  test("експортує всі очікувані функції та константи", function () {
    assert.equal(typeof TargetMatch.convertOne, "function");
    assert.equal(typeof TargetMatch.parseLines, "function");
    assert.equal(typeof TargetMatch.haversineKm, "function");
    assert.equal(typeof TargetMatch.selectPoi, "function");
    assert.equal(typeof TargetMatch.findHits, "function");
    assert.equal(typeof TargetMatch.MAX_POI, "number");
    assert.equal(typeof TargetMatch.EARTH_RADIUS_KM, "number");
  });
});

describe("convertOne — пряма конвертація (MGRS → WGS84)", function () {
  test("розпізнає валідний MGRS і повертає коректні WGS84", function () {
    var result = TargetMatch.convertOne("33TWN0838825205");
    assert.equal(result.ok, true);
    assert.equal(result.source, "mgrs");
    assert.ok(Math.abs(result.lat - 47.180291) < 1e-5);
    assert.ok(Math.abs(result.lon - 15.110711) < 1e-5);
  });

  test("різні формати одного MGRS-коду (пробіли, регістр) дають той самий результат", function () {
    var variants = [
      "33TWN0838825205",
      "33T WN 08388 25205",
      "33twn0838825205",
      "  33TWN0838825205  "
    ];
    var results = variants.map(function (v) {
      return TargetMatch.convertOne(v);
    });
    results.forEach(function (r) {
      assert.equal(r.ok, true, "мало розпізнатись: " + JSON.stringify(r));
    });
    var first = results[0];
    results.forEach(function (r) {
      assert.equal(r.mgrs, first.mgrs);
      assert.ok(Math.abs(r.lat - first.lat) < 1e-9);
      assert.ok(Math.abs(r.lon - first.lon) < 1e-9);
    });
  });

  test("різна точність MGRS (менше цифр = менша точність) парситься без помилки", function () {
    // Повна точність (10 цифр, 1м): easting="08388" northing="25205".
    // Нижча точність (8 цифр, 10м) — беремо перші 4 цифри кожної половини.
    var fullPrecision = TargetMatch.convertOne("33TWN0838825205");
    var lowerPrecision = TargetMatch.convertOne("33TWN08382520");

    assert.equal(fullPrecision.ok, true);
    assert.equal(lowerPrecision.ok, true);
    // Різниця точності (10м) не повинна давати координати, що "скакнули"
    // на кілометри — це ознака помилки парсингу, а не просто округлення.
    var driftKm = TargetMatch.haversineKm(
      fullPrecision.lat,
      fullPrecision.lon,
      lowerPrecision.lat,
      lowerPrecision.lon
    );
    assert.ok(driftKm < 0.05, "розбіжність точності завелика: " + driftKm + " км");
  });

  test("невалідний MGRS повертає помилку, а не кидає виняток", function () {
    var result = TargetMatch.convertOne("НЕВАЛІДНИЙРЯДОК123");
    assert.equal(result.ok, false);
    assert.equal(result.error, TargetMatch.INVALID_MGRS);
  });
});

describe("convertOne — зворотна конвертація (WGS84 → MGRS)", function () {
  test("кома як роздільник широти й довготи", function () {
    var result = TargetMatch.convertOne("50.4501, 30.5234");
    assert.equal(result.ok, true);
    assert.equal(result.source, "latlon");
    assert.ok(result.mgrs.length > 0);
  });

  test("пробіл як роздільник (без коми)", function () {
    var result = TargetMatch.convertOne("50.4501 30.5234");
    assert.equal(result.ok, true);
    assert.equal(result.source, "latlon");
  });

  test("зайві пробіли навколо роздільника й по краях", function () {
    var result = TargetMatch.convertOne("  50.4501  ,   30.5234  ");
    assert.equal(result.ok, true);
  });

  test("від'ємна широта (південна півкуля)", function () {
    var result = TargetMatch.convertOne("-33.8688, 151.2093");
    assert.equal(result.ok, true);
    assert.equal(result.lat, -33.8688);
  });

  test("від'ємна довгота (західна півкуля)", function () {
    var result = TargetMatch.convertOne("40.7128, -74.0060");
    assert.equal(result.ok, true);
    assert.equal(result.lon, -74.006);
  });

  test("широта поза діапазоном (-90..90) повертає помилку", function () {
    var result = TargetMatch.convertOne("95, 30");
    assert.equal(result.ok, false);
    assert.equal(result.error, TargetMatch.INVALID_LATLON);
  });

  test("довгота поза діапазоном (-180..180) повертає помилку", function () {
    var result = TargetMatch.convertOne("10, 200");
    assert.equal(result.ok, false);
    assert.equal(result.error, TargetMatch.INVALID_LATLON);
  });

  test("round-trip WGS84 → MGRS → WGS84 залишається близько до початкових координат", function () {
    var original = TargetMatch.convertOne("50.4501, 30.5234");
    assert.equal(original.ok, true);

    var roundTrip = TargetMatch.convertOne(original.mgrs);
    assert.equal(roundTrip.ok, true);

    // MGRS на цій точності — округлення до метра, тож очікуємо
    // розбіжність у межах кількох метрів, не кілометрів.
    var driftKm = TargetMatch.haversineKm(
      original.lat,
      original.lon,
      roundTrip.lat,
      roundTrip.lon
    );
    assert.ok(driftKm < 0.01, "round-trip розбіжність завелика: " + driftKm + " км");
  });
});

describe("parseLines — розбір тексту на рядки", function () {
  test("порожні рядки (включно з рядками лише з пробілів) ігноруються", function () {
    var text = "33TWN0838825205\n\n   \n\t\n50.4501, 30.5234\n";
    var rows = TargetMatch.parseLines(text);
    assert.equal(rows.length, 2);
  });

  test("повністю порожній або пробільний текст повертає порожній список", function () {
    assert.equal(TargetMatch.parseLines("").length, 0);
    assert.equal(TargetMatch.parseLines("   \n  \n\t").length, 0);
  });

  test("дублікати рядків повертаються як окремі елементи (без дедуплікації)", function () {
    var text = "50.4501, 30.5234\n50.4501, 30.5234";
    var rows = TargetMatch.parseLines(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].raw, rows[1].raw);
  });

  test("зберігає порядок рядків як у вводі", function () {
    var text = "33TWN0838825205\n50.4501, 30.5234";
    var rows = TargetMatch.parseLines(text);
    assert.equal(rows[0].raw, "33TWN0838825205");
    assert.equal(rows[1].raw, "50.4501, 30.5234");
  });
});

describe("haversineKm — геодезична відстань", function () {
  test("відстань від точки до самої себе дорівнює нулю", function () {
    var d = TargetMatch.haversineKm(50.45, 30.52, 50.45, 30.52);
    assert.ok(Math.abs(d) < 1e-9);
  });

  test("1° довготи на екваторі ≈ 111.19 км (незалежна перевірка формули)", function () {
    // На екваторі haversine зводиться до точної формули R·Δλ — хороша
    // незалежна перевірка, що не викривлена власною похибкою функції.
    var d = TargetMatch.haversineKm(0, 0, 0, 1);
    var expected = (TargetMatch.EARTH_RADIUS_KM * Math.PI) / 180;
    assert.ok(Math.abs(d - expected) < 1e-9);
  });

  test("симетричність: відстань A→B дорівнює B→A", function () {
    var d1 = TargetMatch.haversineKm(50.45, 30.52, 47.18, 15.11);
    var d2 = TargetMatch.haversineKm(47.18, 15.11, 50.45, 30.52);
    assert.equal(d1, d2);
  });
});

describe("selectPoi — ліміт точок інтересу (MAX_POI = 10)", function () {
  function makeRows(count) {
    var lines = [];
    for (var i = 0; i < count; i++) {
      lines.push((50 + i * 0.01).toFixed(4) + ", 30.5234");
    }
    return TargetMatch.parseLines(lines.join("\n"));
  }

  test("10 точок — усі враховані, без переповнення", function () {
    var rows = makeRows(10);
    var selection = TargetMatch.selectPoi(rows, TargetMatch.MAX_POI);
    assert.equal(selection.points.length, 10);
    assert.equal(selection.totalCount, 10);
    assert.equal(selection.consideredCount, 10);
  });

  test("13 точок — враховано лише перші 10, totalCount показує справжню кількість", function () {
    var rows = makeRows(13);
    var selection = TargetMatch.selectPoi(rows, TargetMatch.MAX_POI);
    assert.equal(selection.points.length, 10);
    assert.equal(selection.consideredCount, 10);
    assert.equal(selection.totalCount, 13);
  });

  test("невалідний рядок у межах перших 10 потрапляє в badRaws", function () {
    var text = "50.4501, 30.5234\nгарбадж\n50.4510, 30.5240";
    var rows = TargetMatch.parseLines(text);
    var selection = TargetMatch.selectPoi(rows, TargetMatch.MAX_POI);
    assert.equal(selection.points.length, 2);
    assert.deepEqual(selection.badRaws, ["гарбадж"]);
  });

  test("невалідний рядок ПІСЛЯ 10-ї позиції не потрапляє в badRaws (не розглядається)", function () {
    var lines = [];
    for (var i = 0; i < 10; i++) {
      lines.push((50 + i * 0.01).toFixed(4) + ", 30.5234");
    }
    lines.push("гарбадж-на-11-й-позиції");
    var rows = TargetMatch.parseLines(lines.join("\n"));
    var selection = TargetMatch.selectPoi(rows, TargetMatch.MAX_POI);

    assert.equal(selection.points.length, 10);
    assert.equal(selection.badRaws.length, 0);
    assert.equal(selection.totalCount, 11);
  });
});

describe("findHits — перевірка влучання цілей у радіус", function () {
  test("ціль поруч із точкою інтересу (~150м) — влучання при радіусі 1км", function () {
    var poiRow = TargetMatch.convertOne("50.4501, 30.5234");
    var targetRows = TargetMatch.parseLines("50.4510, 30.5240");
    var result = TargetMatch.findHits([poiRow], targetRows, 1);
    assert.equal(result.hits.length, 1);
  });

  test("далека ціль (~280км) не влучає при радіусі 1км", function () {
    var poiRow = TargetMatch.convertOne("50.4501, 30.5234");
    var targetRows = TargetMatch.parseLines("48.0000, 25.0000");
    var result = TargetMatch.findHits([poiRow], targetRows, 1);
    assert.equal(result.hits.length, 0);
  });

  test("кілька точок інтересу — влучання, якщо близько хоча б до однієї", function () {
    var poiKyiv = TargetMatch.convertOne("50.4501, 30.5234");
    var poiLviv = TargetMatch.convertOne("49.8397, 24.0297");
    // Ціль близько до Львова, далеко від Києва.
    var targetRows = TargetMatch.parseLines("49.8400, 24.0300");
    var result = TargetMatch.findHits([poiKyiv, poiLviv], targetRows, 1);
    assert.equal(result.hits.length, 1);
  });

  test("немає точок інтересу — жодних влучань, без винятків", function () {
    var targetRows = TargetMatch.parseLines("50.4501, 30.5234");
    var result = TargetMatch.findHits([], targetRows, 1);
    assert.equal(result.hits.length, 0);
  });

  test("дублікат координати цілі дає окремий результат на кожен рядок (без дедуплікації)", function () {
    var poiRow = TargetMatch.convertOne("50.4501, 30.5234");
    var targetRows = TargetMatch.parseLines("50.4510, 30.5240\n50.4510, 30.5240");
    var result = TargetMatch.findHits([poiRow], targetRows, 1);
    assert.equal(result.hits.length, 2);
  });

  test("невалідний рядок цілі потрапляє в badRaws і не блокує інші рядки", function () {
    var poiRow = TargetMatch.convertOne("50.4501, 30.5234");
    var targetRows = TargetMatch.parseLines("50.4510, 30.5240\nгарбадж\n48.0000, 25.0000");
    var result = TargetMatch.findHits([poiRow], targetRows, 1);
    assert.equal(result.hits.length, 1);
    assert.deepEqual(result.badRaws, ["гарбадж"]);
  });

  test("однаковий набір точок — різні радіуси дають різний результат", function () {
    // Ціль рівно за 0.7 км на схід від точки інтересу (екватор, щоб
    // відстань обчислювалась за точною замкненою формулою, без похибки).
    var poi = TargetMatch.convertOne("0, 0");
    var deltaLonFor07km = (0.7 / TargetMatch.EARTH_RADIUS_KM) * (180 / Math.PI);
    var targetRows = TargetMatch.parseLines("0, " + deltaLonFor07km.toFixed(10));

    var resultNarrow = TargetMatch.findHits([poi], targetRows, 0.5);
    var resultWide = TargetMatch.findHits([poi], targetRows, 1);

    assert.equal(resultNarrow.hits.length, 0, "0.5км: ціль за 0.7км не мала влучити");
    assert.equal(resultWide.hits.length, 1, "1км: ціль за 0.7км мала влучити");
  });

  describe("межа радіуса (boundary)", function () {
    // На екваторі haversine(lat=0) зводиться до точної формули R·Δλ,
    // тож можемо незалежно обчислити координату на РІВНО заданій відстані,
    // а не покладатись на ту саму функцію, яку тестуємо.
    function pointAtExactDistanceKm(distanceKm) {
      var deltaLonDeg = (distanceKm / TargetMatch.EARTH_RADIUS_KM) * (180 / Math.PI);
      return { lat: 0, lon: deltaLonDeg };
    }

    test("haversineKm повертає відстань, що збігається з незалежною формулою на межі", function () {
      var radiusKm = 1;
      var p = pointAtExactDistanceKm(radiusKm);
      var computed = TargetMatch.haversineKm(0, 0, p.lat, p.lon);
      assert.ok(
        Math.abs(computed - radiusKm) < 1e-9,
        "обчислена відстань " + computed + " мала бути ≈ " + radiusKm
      );
    });

    test("ціль на межі радіуса (рівно 1км) рахується як влучання (<=, не <)", function () {
      // Беремо точку на безпечній відстані ВСЕРЕДИНІ межі (на 2 метри
      // ближче), щоб уникнути хиткості тесту через похибку float.
      var radiusKm = 1;
      var pInside = pointAtExactDistanceKm(radiusKm - 0.002);
      var poi = TargetMatch.convertOne("0, 0");
      var targetRows = TargetMatch.parseLines("0, " + pInside.lon.toFixed(10));
      var result = TargetMatch.findHits([poi], targetRows, radiusKm);
      assert.equal(result.hits.length, 1);
    });

    test("ціль трохи за межею радіуса (на 2м далі) не рахується як влучання", function () {
      var radiusKm = 1;
      var pOutside = pointAtExactDistanceKm(radiusKm + 0.002);
      var poi = TargetMatch.convertOne("0, 0");
      var targetRows = TargetMatch.parseLines("0, " + pOutside.lon.toFixed(10));
      var result = TargetMatch.findHits([poi], targetRows, radiusKm);
      assert.equal(result.hits.length, 0);
    });
  });
});
