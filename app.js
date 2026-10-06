(function () {
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

  function createCopyIconButton(text, labelText, badgeText) {
    var title = labelText || "Копіювати";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "link-accent link-icon icon-button";
    button.title = title;

    var iconCopy = copyIconSvg("icon icon-copy");
    var iconCheck = checkIconSvg("icon icon-check");
    setHidden(iconCheck, true);

    var label = document.createElement("span");
    label.className = "sr-only";
    label.textContent = title;

    button.appendChild(iconCopy);
    button.appendChild(iconCheck);

    if (badgeText) {
      var badge = document.createElement("span");
      badge.className = "copy-badge";
      badge.textContent = badgeText;
      badge.setAttribute("aria-hidden", "true");
      button.appendChild(badge);
    }

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
          label.textContent = title;
          button.title = title;
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

    // Дві окремі кнопки — користувач сам обирає, що копіювати,
    // замість неочевидного "копіюємо протилежний формат".
    var wgsValue = converted.lat.toFixed(6) + ", " + converted.lon.toFixed(6);
    rowActions.appendChild(
      createCopyIconButton(converted.mgrs, "Копіювати MGRS", "MGRS")
    );
    rowActions.appendChild(
      createCopyIconButton(wgsValue, "Копіювати WGS84", "WGS")
    );

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

  // --- Попередження під полями (спільне для точок інтересу й цілей) ---

  // badDetails — масив {raw, error} з selectPoi()/findHits(). reasonFor
  // дає змогу кожному викликачу самому вирішити, яку причину показати:
  // POI показує heuristично кращу підказку (explainUnrecognizedLine),
  // цілі — точну причину з convertOne() (INVALID_MGRS тощо).
  function formatBadList(badDetails, reasonFor) {
    return badDetails
      .map(function (detail) {
        return "«" + detail.raw + "» (" + reasonFor(detail) + ")";
      })
      .join("; ");
  }

  function setWarning(el, text) {
    if (text) {
      setHidden(el, false);
      el.textContent = text;
    } else {
      setHidden(el, true);
      el.textContent = "";
    }
  }

  // --- Точки інтересу ---

  function renderPoi() {
    var rows = TargetMatch.parseLines(poiInput.value);
    var selection = TargetMatch.selectPoi(rows, TargetMatch.MAX_POI);

    poiBody.textContent = "";
    for (var i = 0; i < selection.points.length; i++) {
      poiBody.appendChild(buildRow(selection.points[i]));
    }

    if (selection.points.length) {
      setHidden(poiTableWrap, false);
      setHidden(poiPlaceholder, true);
    } else {
      setHidden(poiTableWrap, true);
      setHidden(poiPlaceholder, false);
    }

    var warningParts = [];
    if (selection.badDetails.length) {
      warningParts.push(
        "Не вдалося розпізнати (" +
          selection.badDetails.length +
          "): " +
          formatBadList(selection.badDetails, function (detail) {
            return TargetMatch.explainUnrecognizedLine(detail.raw);
          })
      );
    }
    if (selection.totalCount > TargetMatch.MAX_POI) {
      warningParts.push(
        "Враховано лише перші " +
          TargetMatch.MAX_POI +
          " точок (введено " +
          selection.totalCount +
          ")."
      );
    }
    setWarning(poiWarning, warningParts.join(" "));

    return selection.points;
  }

  // --- Цілі противника: перевірка влучання в радіус ---

  function runCheck() {
    var points = renderPoi();
    var targetRows = TargetMatch.parseFreeform(targetsInput.value);
    var result = TargetMatch.findHits(points, targetRows, currentRadiusKm);

    hitsBody.textContent = "";
    for (var k = 0; k < result.hits.length; k++) {
      hitsBody.appendChild(buildRow(result.hits[k]));
    }

    if (result.hits.length) {
      setHidden(hitsTableWrap, false);
      setHidden(hitsPlaceholder, true);
    } else {
      setHidden(hitsTableWrap, true);
      setHidden(hitsPlaceholder, false);
      hitsPlaceholder.textContent = points.length
        ? "Жодна ціль не потрапила в радіус."
        : "Додайте хоча б одну точку інтересу.";
    }

    var targetsMessage = result.badDetails.length
      ? "Не вдалося розпізнати (" +
        result.badDetails.length +
        "): " +
        formatBadList(result.badDetails, function (detail) {
          return detail.error;
        })
      : "";
    setWarning(targetsWarning, targetsMessage);
  }

  // --- Перемикач радіуса ---

  // Перераховуємо влучання автоматично при зміні радіуса, але лише якщо
  // користувач уже хоч раз натискав "Перевірити цілі" — інакше перемикання
  // радіуса ДО першої перевірки показало б "Жодна ціль не потрапила" або
  // "Додайте точку інтересу" замість нейтрального стартового плейсхолдера.
  var hasChecked = false;

  for (var r = 0; r < radiusButtons.length; r++) {
    radiusButtons[r].addEventListener("click", function () {
      for (var x = 0; x < radiusButtons.length; x++) {
        radiusButtons[x].classList.remove("is-active");
      }
      this.classList.add("is-active");
      currentRadiusKm = parseFloat(this.getAttribute("data-radius"));
      if (hasChecked) {
        runCheck();
      }
    });
  }

  checkButton.addEventListener("click", function () {
    hasChecked = true;
    runCheck();
  });
})();
