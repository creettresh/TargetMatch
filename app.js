(function () {
  var INVALID_MGRS = "Невалідний MGRS";
  var INVALID_LATLON = "Невалідні WGS84-координати (широта -90..90, довгота -180..180)";
  var MAX_POI = 10;
  var EARTH_RADIUS_KM = 6371;

  // "47.180291, 15.110711" або "47.180291 15.110711" — широта, потім довгота.
  var LATLON_RE = /^(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/;

  var poiInput = document.getElementById("poi");
  var poiTableWrap = document.getElementById("poi-table-wrap");
  var poiBody = document.getElementById("poi-body");
  var poiPlaceholder = document.getElementById("poi-placeholder");
  var poiWarning = document.getElementById("poi-warning");
  var radiusButtons = document.querySelectorAll(".radius-option");

  var targetsInput = document.getElementById("targets");
  var checkButton = document.getElementById("check");
  var targetsWarning = document.getElementById("targets-warning");
  var hitsTableWrap = document.getElementById("hits-table-wrap");
  var hitsBody = document.getElementById("hits-body");
  var hitsPlaceholder = document.getElementById("hits-placeholder");

  var currentRadiusKm = 1;

  function setHidden(el, isHidden) {
    if (isHidden) {
      el.setAttribute("hidden", "");
    } else {
      el.removeAttribute("hidden");
    }
  }

  function normalize(value) {
    return value.replace(/\s+/g, "").toUpperCase();
  }

  // Авто-визначення формату: MGRS чи WGS84 (широта, довгота).
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

  function mapUrl(lat, lon) {
    return "https://www.google.com/maps?q=" + lat.toFixed(6) + "," + lon.toFixed(6);
  }

  // --- Копіювання в буфер + іконки (копія / галочка) ---

  var SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    for (var key in attrs) {
      el.setAttribute(key, attrs[key]);
    }
    return el;
  }

  function copyIconSvg(className) {
    var svg = svgEl("svg", {
      class: className,
      viewBox: "0 0 16 16",
      "aria-hidden": "true",
      focusable: "false"
    });
    svg.appendChild(
      svgEl("rect", {
        x: "5.5",
        y: "5.5",
        width: "8",
        height: "8",
        rx: "1.3",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.3"
      })
    );
    svg.appendChild(
      svgEl("path", {
        d: "M3.3 10.2V3.8a1 1 0 0 1 1-1h6.4",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.3",
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      })
    );
    return svg;
  }

  function checkIconSvg(className) {
    var svg = svgEl("svg", {
      class: className,
      viewBox: "0 0 16 16",
      "aria-hidden": "true",
      focusable: "false"
    });
    svg.appendChild(
      svgEl("path", {
        d: "M3.5 8.5l3 3 6-6",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.6",
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      })
    );
    return svg;
  }

  function copyText(text, onCopied, onReset) {
    if (!text) {
      return;
    }
    function done() {
      onCopied();
      setTimeout(onReset, 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        fallbackCopy(text);
        done();
      });
      return;
    }
    fallbackCopy(text);
    done();
  }

  function fallbackCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
  }

  function createCopyIconButton(text) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "link-accent link-icon icon-button";
    button.title = "Копіювати";

    var iconCopy = copyIconSvg("icon icon-copy");
    var iconCheck = checkIconSvg("icon icon-check");
    setHidden(iconCheck, true);

    var label = document.createElement("span");
    label.className = "sr-only";
    label.textContent = "Копіювати";

    button.appendChild(iconCopy);
    button.appendChild(iconCheck);
    button.appendChild(label);

    button.addEventListener("click", function () {
      copyText(
        text,
        function () {
          label.textContent = "Скопійовано";
          button.title = "Скопійовано";
          setHidden(iconCopy, true);
          setHidden(iconCheck, false);
        },
        function () {
          label.textContent = "Копіювати";
          button.title = "Копіювати";
          setHidden(iconCopy, false);
          setHidden(iconCheck, true);
        }
      );
    });

    return button;
  }

  // --- Побудова рядка таблиці (спільна для точок інтересу й цілей) ---

  function buildRow(converted) {
    var tr = document.createElement("tr");
    var mgrsCell = document.createElement("td");
    var latCell = document.createElement("td");
    var lonCell = document.createElement("td");
    var actionsCell = document.createElement("td");

    mgrsCell.textContent = converted.mgrs;
    latCell.textContent = converted.lat.toFixed(6);
    lonCell.textContent = converted.lon.toFixed(6);

    var rowActions = document.createElement("span");
    rowActions.className = "row-actions";

    // Копіюємо обчислене значення — протилежне до того, що ввели.
    var copyValue =
      converted.source === "latlon"
        ? converted.mgrs
        : converted.lat.toFixed(6) + ", " + converted.lon.toFixed(6);
    rowActions.appendChild(createCopyIconButton(copyValue));

    var mapLink = document.createElement("a");
    mapLink.href = mapUrl(converted.lat, converted.lon);
    mapLink.target = "_blank";
    mapLink.rel = "noopener noreferrer";
    mapLink.textContent = "Карта";
    rowActions.appendChild(mapLink);

    actionsCell.appendChild(rowActions);

    tr.appendChild(mgrsCell);
    tr.appendChild(latCell);
    tr.appendChild(lonCell);
    tr.appendChild(actionsCell);
    return tr;
  }

  // --- Точки інтересу ---

  function renderPoi() {
    var rows = parseLines(poiInput.value);
    var limited = rows.slice(0, MAX_POI);

    poiBody.textContent = "";
    var points = [];
    var bad = [];

    for (var i = 0; i < limited.length; i++) {
      var row = limited[i];
      if (row.converted.ok) {
        points.push(row.converted);
        poiBody.appendChild(buildRow(row.converted));
      } else {
        bad.push(row.raw);
      }
    }

    if (points.length) {
      setHidden(poiTableWrap, false);
      setHidden(poiPlaceholder, true);
    } else {
      setHidden(poiTableWrap, true);
      setHidden(poiPlaceholder, false);
    }

    var warningParts = [];
    if (bad.length) {
      warningParts.push("Не вдалося розпізнати (" + bad.length + "): " + bad.join("; "));
    }
    if (rows.length > MAX_POI) {
      warningParts.push(
        "Враховано лише перші " + MAX_POI + " точок (введено " + rows.length + ")."
      );
    }
    if (warningParts.length) {
      setHidden(poiWarning, false);
      poiWarning.textContent = warningParts.join(" ");
    } else {
      setHidden(poiWarning, true);
      poiWarning.textContent = "";
    }

    return points;
  }

  // --- Цілі противника: перевірка влучання в радіус ---

  function runCheck() {
    var points = renderPoi();
    var targetRows = parseLines(targetsInput.value);

    var bad = [];
    var hits = [];

    for (var i = 0; i < targetRows.length; i++) {
      var row = targetRows[i];
      if (!row.converted.ok) {
        bad.push(row.raw);
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
        if (distanceKm <= currentRadiusKm) {
          isHit = true;
          break;
        }
      }
      if (isHit) {
        hits.push(row.converted);
      }
    }

    hitsBody.textContent = "";
    for (var k = 0; k < hits.length; k++) {
      hitsBody.appendChild(buildRow(hits[k]));
    }

    if (hits.length) {
      setHidden(hitsTableWrap, false);
      setHidden(hitsPlaceholder, true);
    } else {
      setHidden(hitsTableWrap, true);
      setHidden(hitsPlaceholder, false);
      hitsPlaceholder.textContent = points.length
        ? "Жодна ціль не потрапила в радіус."
        : "Додайте хоча б одну точку інтересу.";
    }

    if (bad.length) {
      setHidden(targetsWarning, false);
      targetsWarning.textContent =
        "Не вдалося розпізнати (" + bad.length + "): " + bad.join("; ");
    } else {
      setHidden(targetsWarning, true);
      targetsWarning.textContent = "";
    }
  }

  // --- Перемикач радіуса ---

  for (var r = 0; r < radiusButtons.length; r++) {
    radiusButtons[r].addEventListener("click", function () {
      for (var x = 0; x < radiusButtons.length; x++) {
        radiusButtons[x].classList.remove("is-active");
      }
      this.classList.add("is-active");
      currentRadiusKm = parseFloat(this.getAttribute("data-radius"));
    });
  }

  checkButton.addEventListener("click", runCheck);
})();
