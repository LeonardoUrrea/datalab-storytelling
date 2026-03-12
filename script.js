const CSV_PATH = "resumen_dia_turno.csv";

const PDF_CONFIG = {
  local: "PROYECTOR_2.pdf",
  online: "PROYECTOR_2.pdf"
  // Si después publica el PDF en otra URL pública,
  // puede reemplazar "online" por esa ruta completa.
};

const MONTHS_ES = [
  "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const COLORS = {
  green: "#7ddc4f",
  green2: "#35c46a",
  orange: "#ff8b3d",
  yellow: "#f4c542",
  red: "#ff6363",
  blue: "#60a5fa",
  grid: "rgba(255,255,255,0.08)",
  text: "#edf3f8",
  muted: "#b8c3ce"
};

let rawData = [];

let charts = {
  timeline: null,
  barTurnos: null,
  bubble: null,
  scenario: null
};

const state = {
  turno: "Todos",
  mes: "Todos"
};

document.addEventListener("DOMContentLoaded", () => {
  const turnoFilter = document.getElementById("turnoFilter");
  const mesFilter = document.getElementById("mesFilter");
  const resetFilters = document.getElementById("resetFilters");

  if (turnoFilter) {
    turnoFilter.addEventListener("change", (e) => {
      state.turno = e.target.value;
      updateDashboard();
    });
  }

  if (mesFilter) {
    mesFilter.addEventListener("change", (e) => {
      state.mes = e.target.value;
      updateDashboard();
    });
  }

  if (resetFilters) {
    resetFilters.addEventListener("click", () => {
      state.turno = "Todos";
      state.mes = "Todos";

      if (turnoFilter) turnoFilter.value = "Todos";
      if (mesFilter) mesFilter.value = "Todos";

      updateDashboard();
    });
  }

  initRevealAnimations();
  initStoryProgress();
  initPdfLinks();
  loadData();
});

function loadData() {
  Papa.parse(CSV_PATH, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      rawData = results.data
        .map(row => ({
          Fecha_Simple: row.Fecha_Simple,
          fecha: new Date(row.Fecha_Simple + "T00:00:00"),
          Turno: String(row.Turno || "").trim(),
          Minutos: Number(row.Minutos),
          Analistas_Reales: Number(row.Analistas_Reales),
          Registros: Number(row.Registros),
          Capacidad_Dinamica: Number(row.Capacidad_Dinamica),
          Utilizacion_Diaria: Number(row.Utilizacion_Diaria),
          Nivel_Presion: String(row.Nivel_Presion || "").trim()
        }))
        .filter(d =>
          d.Fecha_Simple &&
          !Number.isNaN(d.Minutos) &&
          !Number.isNaN(d.Capacidad_Dinamica) &&
          d.fecha instanceof Date &&
          !Number.isNaN(d.fecha.getTime()) &&
          d.fecha.getFullYear() === 2025
        );

      updateDashboard();
    },
    error: () => {
      alert("No se pudo cargar el archivo resumen_dia_turno.csv. Verifique que esté en la raíz del repositorio.");
    }
  });
}

function updateDashboard() {
  const filtered = getFilteredData();

  updateKPIs(filtered);
  renderTimeline(filtered);
  renderBarTurnos(filtered);
  renderBubble(filtered);
  renderScenario(filtered);
  updateInsights(filtered);
}

function getFilteredData() {
  return rawData.filter(d => {
    const turnoMatch = state.turno === "Todos" || d.Turno === state.turno;
    const mesMatch = state.mes === "Todos" || (d.fecha.getMonth() + 1) === Number(state.mes);
    return turnoMatch && mesMatch;
  });
}

function updateKPIs(data) {
  const avgPressure = mean(data.map(d => safeDivide(d.Minutos, d.Capacidad_Dinamica)));
  const pctHigh = mean(data.map(d => (d.Utilizacion_Diaria > 1 ? 1 : 0)));

  const byTurno = groupBy(rawData, "Turno");
  const turnoStats = Object.entries(byTurno)
    .map(([turno, values]) => ({
      turno,
      pctHigh: mean(values.map(v => (v.Utilizacion_Diaria > 1 ? 1 : 0)))
    }))
    .sort((a, b) => b.pctHigh - a.pctHigh);

  animateValue("kpiPromedio", avgPressure, "percent");
  animateValue("kpiAltaPresion", pctHigh, "percent");

  const kpiTurnoCritico = document.getElementById("kpiTurnoCritico");
  if (kpiTurnoCritico) {
    kpiTurnoCritico.textContent = turnoStats.length ? `Turno ${turnoStats[0].turno}` : "--";
  }
}

function renderTimeline(data) {
  const canvas = document.getElementById("timelineChart");
  if (!canvas) return;

  const dailyMap = new Map();

  data.forEach(d => {
    const key = d.Fecha_Simple;
    if (!dailyMap.has(key)) dailyMap.set(key, []);
    dailyMap.get(key).push(d);
  });

  const ordered = [...dailyMap.entries()]
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .map(([date, rows]) => ({
      date,
      util: mean(rows.map(r => r.Utilizacion_Diaria))
    }));

  const labels = ordered.map(d => formatDateShort(d.date));
  const values = ordered.map(d => round2(d.util));

  destroyChart("timeline");
  charts.timeline = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Utilización diaria",
          data: values,
          borderColor: COLORS.green,
          backgroundColor: "rgba(125, 220, 79, 0.16)",
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2.5
        },
        {
          label: "Límite de saturación",
          data: values.map(() => 1),
          borderColor: COLORS.orange,
          borderDash: [8, 6],
          pointRadius: 0,
          borderWidth: 2
        }
      ]
    },
    options: chartOptions({
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: baseLegend(),
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatPercent(ctx.raw)}`
          }
        }
      },
      scales: {
        x: baseXAxis(),
        y: {
          ...baseYAxis(),
          suggestedMin: 0,
          suggestedMax: 1.2,
          ticks: {
            color: COLORS.muted,
            callback: value => `${Math.round(value * 100)}%`
          }
        }
      }
    })
  });
}

function renderBarTurnos(data) {
  const canvas = document.getElementById("barTurnosChart");
  if (!canvas) return;

  const grouped = groupBy(data, "Turno");
  const order = ["A", "B", "C"];

  const labels = [];
  const values = [];

  order.forEach(turno => {
    if (grouped[turno] && grouped[turno].length) {
      labels.push(`Turno ${turno}`);
      values.push(mean(grouped[turno].map(d => (d.Utilizacion_Diaria > 1 ? 1 : 0))));
    }
  });

  destroyChart("barTurnos");
  charts.barTurnos = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "% de días críticos",
        data: values,
        backgroundColor: [COLORS.blue, COLORS.yellow, COLORS.orange],
        borderRadius: 10
      }]
    },
    options: chartOptions({
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => formatPercent(ctx.raw)
          }
        }
      },
      scales: {
        x: {
          ...baseXAxis(),
          ticks: {
            color: COLORS.muted,
            callback: value => `${Math.round(value * 100)}%`
          },
          suggestedMax: Math.max(0.4, ...values, 0.1) + 0.05
        },
        y: baseYAxis()
      }
    })
  });
}

function renderBubble(data) {
  const canvas = document.getElementById("bubbleChart");
  if (!canvas) return;

  const grouped = groupBy(data, "Turno");
  const order = ["A", "B", "C"];

  const bubbleData = order
    .filter(turno => grouped[turno] && grouped[turno].length)
    .map((turno) => {
      const rows = grouped[turno];
      const avgAnalistas = mean(rows.map(r => r.Analistas_Reales));
      const avgMinutos = mean(rows.map(r => r.Minutos));
      const pctCrit = mean(rows.map(r => (r.Utilizacion_Diaria > 1 ? 1 : 0)));

      return {
        x: round2(avgAnalistas),
        y: round2(avgMinutos),
        r: Math.max(10, pctCrit * 65),
        turno
      };
    });

  destroyChart("bubble");
  charts.bubble = new Chart(canvas, {
    type: "bubble",
    data: {
      datasets: [{
        label: "Turnos",
        data: bubbleData,
        backgroundColor: [
          "rgba(96,165,250,0.65)",
          "rgba(244,197,66,0.70)",
          "rgba(255,139,61,0.72)"
        ],
        borderColor: [COLORS.blue, COLORS.yellow, COLORS.orange],
        borderWidth: 1.8
      }]
    },
    options: chartOptions({
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const point = ctx.raw;
              return [
                `Turno ${point.turno}`,
                `Analistas promedio: ${point.x}`,
                `Minutos promedio: ${point.y}`,
                "Tamaño burbuja: presión crítica relativa"
              ];
            }
          }
        }
      },
      scales: {
        x: {
          ...baseXAxis(),
          title: {
            display: true,
            text: "Analistas reales promedio",
            color: COLORS.muted
          }
        },
        y: {
          ...baseYAxis(),
          title: {
            display: true,
            text: "Minutos promedio por día",
            color: COLORS.muted
          }
        }
      }
    })
  });
}

function renderScenario(data) {
  const canvas = document.getElementById("scenarioChart");
  if (!canvas) return;

  const actual = mean(data.map(d => (d.Utilizacion_Diaria > 1 ? 1 : 0)));

  const mas1 = mean(data.map(d => {
    const cap = d.Turno === "C" ? d.Capacidad_Dinamica + 480 : d.Capacidad_Dinamica;
    return safeDivide(d.Minutos, cap) > 1 ? 1 : 0;
  }));

  const mas2 = mean(data.map(d => {
    const cap = d.Turno === "C" ? d.Capacidad_Dinamica + 960 : d.Capacidad_Dinamica;
    return safeDivide(d.Minutos, cap) > 1 ? 1 : 0;
  }));

  const labels = ["Actual", "+1 analista en C", "+2 analistas en C"];
  const values = [actual, mas1, mas2];

  destroyChart("scenario");
  charts.scenario = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "% de días en alta presión",
        data: values,
        backgroundColor: [COLORS.red, COLORS.yellow, COLORS.green],
        borderRadius: 12
      }]
    },
    options: chartOptions({
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => formatPercent(ctx.raw)
          }
        }
      },
      scales: {
        x: baseXAxis(),
        y: {
          ...baseYAxis(),
          ticks: {
            color: COLORS.muted,
            callback: value => `${Math.round(value * 100)}%`
          },
          suggestedMax: Math.max(...values, 0.1) + 0.08
        }
      }
    })
  });
}

function updateInsights(data) {
  const diagnosticoEl = document.getElementById("insightDiagnostico");
  const explicacionEl = document.getElementById("insightExplicacion");
  const recomendacionEl = document.getElementById("insightRecomendacion");

  if (!diagnosticoEl || !explicacionEl || !recomendacionEl) return;

  const avgPressure = mean(data.map(d => safeDivide(d.Minutos, d.Capacidad_Dinamica)));
  const pctHigh = mean(data.map(d => (d.Utilizacion_Diaria > 1 ? 1 : 0)));

  const grouped = groupBy(data, "Turno");
  const ranking = Object.entries(grouped)
    .map(([turno, rows]) => ({
      turno,
      pct: mean(rows.map(r => (r.Utilizacion_Diaria > 1 ? 1 : 0))),
      minutos: mean(rows.map(r => r.Minutos)),
      analistas: mean(rows.map(r => r.Analistas_Reales))
    }))
    .sort((a, b) => b.pct - a.pct);

  const top = ranking[0];

  const scopeTurno = state.turno === "Todos" ? "el sistema completo" : `el turno ${state.turno}`;
  const scopeMes = state.mes === "Todos" ? "en el año completo" : `en ${MONTHS_ES[Number(state.mes)]}`;

  let diagnostico = `Para ${scopeTurno}, ${scopeMes}, la presión promedio observada es de ${formatPercent(avgPressure)} y la proporción de días en alta presión es de ${formatPercent(pctHigh)}.`;

  if (pctHigh >= 0.30) {
    diagnostico += " El comportamiento es claramente exigente y sugiere saturación recurrente.";
  } else if (pctHigh >= 0.18) {
    diagnostico += " El sistema no está colapsado de forma permanente, pero sí presenta eventos relevantes de sobrecarga.";
  } else {
    diagnostico += " La operación luce relativamente estable, aunque conviene monitorear periodos pico.";
  }

  let explicacion = "No fue posible calcular una explicación con el filtro seleccionado.";
  if (top) {
    explicacion = `El mayor nivel de criticidad se concentra en el turno ${top.turno}, con ${formatPercent(top.pct)} de días críticos. En promedio, ese bloque opera con ${round2(top.analistas)} analistas y ${formatNumber(top.minutos)} minutos procesados por día, lo que ayuda a explicar la presión observada.`;
  }

  const scenario1 = mean(data.map(d => {
    const cap = d.Turno === "C" ? d.Capacidad_Dinamica + 480 : d.Capacidad_Dinamica;
    return safeDivide(d.Minutos, cap) > 1 ? 1 : 0;
  }));

  const reduction = actualReduction(pctHigh, scenario1);

  let recomendacion = `La mejor acción de corto plazo es reforzar el turno C. Bajo la simulación, adicionar un analista equivalente reduce la alta presión en ${formatPercent(reduction, 0)} respecto al escenario actual.`;

  if (state.turno !== "Todos" && state.turno !== "C") {
    recomendacion += " Aun así, el principal apalancador del sistema sigue estando en el turno nocturno.";
  }

  diagnosticoEl.textContent = diagnostico;
  explicacionEl.textContent = explicacion;
  recomendacionEl.textContent = recomendacion;
}

function actualReduction(actual, improved) {
  if (actual <= 0) return 0;
  return (actual - improved) / actual;
}

function groupBy(array, key) {
  return array.reduce((acc, item) => {
    const value = item[key];
    if (!acc[value]) acc[value] = [];
    acc[value].push(item);
    return acc;
  }, {});
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

function safeDivide(a, b) {
  if (!b || Number.isNaN(b)) return 0;
  return a / b;
}

function round2(value) {
  return Number(value.toFixed(2));
}

function formatPercent(value, decimals = 1) {
  return `${(value * 100).toFixed(decimals).replace(".", ",")} %`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0
  }).format(value);
}

function formatDateShort(dateString) {
  const date = new Date(dateString + "T00:00:00");
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function destroyChart(name) {
  if (charts[name]) {
    charts[name].destroy();
    charts[name] = null;
  }
}

function baseLegend() {
  return {
    labels: {
      color: COLORS.muted,
      usePointStyle: true,
      pointStyle: "line"
    }
  };
}

function baseXAxis() {
  return {
    grid: { color: COLORS.grid },
    ticks: {
      color: COLORS.muted,
      maxTicksLimit: 10
    }
  };
}

function baseYAxis() {
  return {
    grid: { color: COLORS.grid },
    ticks: {
      color: COLORS.muted
    }
  };
}

function chartOptions(customOptions = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 900,
      easing: "easeOutQuart"
    },
    plugins: {
      tooltip: {
        backgroundColor: "rgba(10,18,28,0.95)",
        borderColor: "rgba(255,255,255,0.08)",
        borderWidth: 1,
        titleColor: COLORS.text,
        bodyColor: COLORS.text,
        padding: 12
      }
    },
    ...customOptions
  };
}

/* Premium 2 JS */
function initRevealAnimations() {
  const sections = document.querySelectorAll(".reveal-section");
  if (!sections.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
      }
    });
  }, { threshold: 0.16 });

  sections.forEach(section => observer.observe(section));
}

function initStoryProgress() {
  const progressBar = document.getElementById("storyProgressBar");
  const navLinks = document.querySelectorAll(".story-nav a");

  if (!progressBar || !navLinks.length) return;

  const sections = [...navLinks]
    .map(link => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  function updateProgress() {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;

    progressBar.style.width = `${progress}%`;

    let currentId = "";
    sections.forEach(section => {
      const top = section.offsetTop - 140;
      if (scrollTop >= top) currentId = section.id;
    });

    navLinks.forEach(link => {
      const href = link.getAttribute("href").replace("#", "");
      link.classList.toggle("active", href === currentId);
    });
  }

  window.addEventListener("scroll", updateProgress);
  window.addEventListener("load", updateProgress);
  updateProgress();
}

function animateValue(elementId, endValue, type = "number", duration = 1200) {
  const element = document.getElementById(elementId);
  if (!element) return;

  if (type === "text") {
    element.textContent = endValue;
    return;
  }

  const startTime = performance.now();

  function frame(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = endValue * eased;

    if (type === "percent") {
      element.textContent = formatPercent(current);
    } else {
      element.textContent = round2(current);
    }

    if (progress < 1) {
      requestAnimationFrame(frame);
    }
  }

  requestAnimationFrame(frame);
}

function initPdfLinks() {
  const openLink = document.getElementById("pdfOpenLink");
  const downloadLink = document.getElementById("pdfDownloadLink");
  const viewer = document.getElementById("pdfViewer");

  if (openLink) {
    openLink.href = PDF_CONFIG.online || PDF_CONFIG.local;
  }

  if (downloadLink) {
    downloadLink.href = PDF_CONFIG.local;
  }

  if (viewer) {
    viewer.src = PDF_CONFIG.local;
  }
}
