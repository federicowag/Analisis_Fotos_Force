import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import "./App.css";

function App() {
  const [rows, setRows] = useState([]);
  const [allRows, setAllRows] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState({});
  const [fileName, setFileName] = useState("");
  const [statusFilter, setStatusFilter] = useState("pendientes");
  const [promotorFilter, setPromotorFilter] = useState("todos");
  const [fechaExcluidas, setFechaExcluidas] = useState([]);
  const [search, setSearch] = useState("");
  const [fileKey, setFileKey] = useState("");
  const [lastSaved, setLastSaved] = useState("");
  const [loadedImageUrl, setLoadedImageUrl] = useState("");
  const [lastMark, setLastMark] = useState(null);
  const [slowImageUrl, setSlowImageUrl] = useState("");

  const lastMarkAt = useRef(0);

  const normalize = (value) => String(value ?? "").trim();
  const upper = (value) => normalize(value).toUpperCase();

  const getStorageKey = (key) => {
    return `revisor_bees_force_${key}`;
  };

  const getColumn = (row, possibleNames) => {
    const keys = Object.keys(row);

    for (const name of possibleNames) {
      const found = keys.find((k) => upper(k) === upper(name));
      if (found) return row[found];
    }

    const fuzzy = keys.find((k) =>
      possibleNames.some((name) => upper(k).includes(upper(name)))
    );

    return fuzzy ? row[fuzzy] : "";
  };

  const formatDateValue = (value) => {
    if (!value) return "-";

    if (typeof value === "number") {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (!parsed) return value;

      const day = String(parsed.d).padStart(2, "0");
      const month = String(parsed.m).padStart(2, "0");
      const year = parsed.y;

      return `${day}/${month}/${year}`;
    }

    return normalize(value);
  };

  const getExecutionDate = (row) => {
    const value = getColumn(row, [
      "Fecha Ejecucion",
      "Fecha Ejecución",
      "fecha ejecucion",
      "fecha ejecución",
      "Fecha",
      "fecha",
      "Dia",
      "Día",
      "dia",
      "día",
      "Created At",
      "created_at",
      "Fecha Completada",
      "Fecha de ejecución",
      "Fecha de Ejecución",
    ]);

    return formatDateValue(value);
  };

  const getImageUrl = (row) => {
    return normalize(
      getColumn(row, [
        "Imagen",
        "textoUrl",
        "link",
        "imagen",
        "foto",
        "url",
        "evidencia",
        "image",
        "photo",
      ])
    );
  };

  const getPromotor = (row) => {
    return normalize(
      getColumn(row, [
        "Promotor",
        "promotor",
        "PROMOTOR",
        "ROL_PROMOTOR",
        "Ejecutor",
        "Usuario",
      ])
    );
  };

  const getDistribuidor = (row) => {
    return getColumn(row, [
      "Distri/Directa",
      "distribuidor",
      "DISTRIBUIDOR",
      "desc_ddc_wh",
    ]);
  };

  const getPocId = (row) => {
    return getColumn(row, ["POC ID", "cliente_id", "cliente", "BdrId", "PDV"]);
  };

  const getDetalleTarea = (row) => {
    return getColumn(row, ["Detalle Tarea", "Tarea", "tarea", "TAREA"]);
  };

  const getIdTarea = (row) => {
    return getColumn(row, ["ID Tarea", "id_tarea", "TaskId", "Task Id"]);
  };

  const isCandidate = (row) => {
    const completada =
      Number(getColumn(row, ["Completada", "completada"])) || 0;

    const validada =
      Number(getColumn(row, ["Validada", "validada"])) || 0;

    const justificacion = upper(
      getColumn(row, ["Justificacion", "Justificación", "justificacion"])
    );

    const visitaValida =
      Number(
        getColumn(row, [
          "Visita Valida",
          "visita valida",
          "VISITA VALIDA",
          "Visita Válida",
        ])
      ) || 0;

    const imageUrl = getImageUrl(row);

    const tareaCompletadaNoValidada = completada === 1 && validada === 0;

    const noEstaJustificada =
      !justificacion ||
      justificacion === "SIN JUSTIFICACION" ||
      justificacion === "SIN JUSTIFICACIÓN" ||
      justificacion === "0";

    const tieneVisitaValida = visitaValida === 1;
    const tieneImagen = imageUrl.startsWith("http");

    return (
      tareaCompletadaNoValidada &&
      noEstaJustificada &&
      tieneVisitaValida &&
      tieneImagen
    );
  };

  const handleFile = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setFileName(file.name);

    const newFileKey = `${file.name}_${file.size}_${file.lastModified}`;
    setFileKey(newFileKey);

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const tagged = json.map((row, index) => ({
      ...row,
      __id: `fila-${index}`,
      __fila_original: index + 2,
    }));

    const prepared = tagged.filter(isCandidate);

    setAllRows(tagged);

    const savedProgress = localStorage.getItem(getStorageKey(newFileKey));

    if (savedProgress) {
      try {
        const parsed = JSON.parse(savedProgress);

        setRows(prepared);
        setDecisions(parsed.decisions || {});
        setCurrentIndex(parsed.currentIndex || 0);
        setStatusFilter(parsed.statusFilter || "pendientes");
        setPromotorFilter(parsed.promotorFilter || "todos");
        setFechaExcluidas(parsed.fechaExcluidas || []);
        setSearch(parsed.search || "");
        setLastSaved(parsed.savedAt || "");
        setLastMark(null);
      } catch {
        setRows(prepared);
        setCurrentIndex(0);
        setDecisions({});
        setStatusFilter("pendientes");
        setPromotorFilter("todos");
        setFechaExcluidas([]);
        setSearch("");
        setLastSaved("");
        setLastMark(null);
      }
    } else {
      setRows(prepared);
      setCurrentIndex(0);
      setDecisions({});
      setStatusFilter("pendientes");
      setPromotorFilter("todos");
      setFechaExcluidas([]);
      setSearch("");
      setLastSaved("");
      setLastMark(null);
    }
  };

  useEffect(() => {
    if (!fileKey || rows.length === 0) return;

    const dataToSave = {
      decisions,
      currentIndex,
      statusFilter,
      promotorFilter,
      fechaExcluidas,
      search,
      fileName,
      savedAt: new Date().toLocaleString(),
    };

    localStorage.setItem(getStorageKey(fileKey), JSON.stringify(dataToSave));
    setLastSaved(dataToSave.savedAt);
  }, [
    decisions,
    currentIndex,
    statusFilter,
    promotorFilter,
    fechaExcluidas,
    search,
    fileName,
    fileKey,
    rows.length,
  ]);

  const promotores = useMemo(() => {
    const set = new Set();

    rows.forEach((row) => {
      const promotor = getPromotor(row);
      if (promotor) set.add(promotor);
    });

    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const fechaSortKey = (label) => {
    const [d, m, y] = label.split("/");
    if (!d || !m || !y) return label;
    return `${y}${m.padStart(2, "0")}${d.padStart(2, "0")}`;
  };

  const fechas = useMemo(() => {
    const set = new Set();

    rows.forEach((row) => {
      const fecha = getExecutionDate(row);
      if (fecha && fecha !== "-") set.add(fecha);
    });

    return Array.from(set).sort((a, b) =>
      fechaSortKey(a).localeCompare(fechaSortKey(b))
    );
  }, [rows]);

  const fechaResumen =
    fechaExcluidas.length === 0
      ? "Todas las fechas"
      : `${fechas.length - fechaExcluidas.length} de ${fechas.length} fechas`;

  const toggleFecha = (fecha, incluir) => {
    setFechaExcluidas((prev) =>
      incluir ? prev.filter((f) => f !== fecha) : [...prev, fecha]
    );
    setCurrentIndex(0);
  };

  const filteredRows = useMemo(() => {
    const q = upper(search);

    return rows.filter((row) => {
      const decision = decisions[row.__id];
      const promotor = getPromotor(row);

      const matchesStatus =
        statusFilter === "todos" ||
        (statusFilter === "pendientes" && !decision) ||
        (statusFilter === "correctos" && decision === "correcto") ||
        (statusFilter === "incorrectos" && decision === "incorrecto") ||
        (statusFilter === "fraude" && decision === "fraude");

      const matchesPromotor =
        promotorFilter === "todos" || promotor === promotorFilter;

      const matchesFecha = !fechaExcluidas.includes(getExecutionDate(row));

      const matchesSearch =
        !q || upper(Object.values(row).join(" ")).includes(q);

      return matchesStatus && matchesPromotor && matchesFecha && matchesSearch;
    });
  }, [rows, decisions, statusFilter, promotorFilter, fechaExcluidas, search]);

  const current =
    filteredRows.length > 0
      ? filteredRows[Math.min(currentIndex, filteredRows.length - 1)]
      : null;

  const currentPosition = current
    ? rows.findIndex((row) => row.__id === current.__id) + 1
    : 0;

  const decisionValue = current ? decisions[current.__id] : undefined;
  const currentImageUrl = current ? getImageUrl(current) : "";
  const imageLoading = currentImageUrl !== loadedImageUrl;

  // Mientras la foto no se ve no se puede decidir, pero si tarda demasiado
  // se destraban los botones para no dejar la revisión frenada.
  const blockDecision = imageLoading && slowImageUrl !== currentImageUrl;

  useEffect(() => {
    if (!imageLoading) return undefined;

    const timer = setTimeout(() => setSlowImageUrl(currentImageUrl), 5000);

    return () => clearTimeout(timer);
  }, [imageLoading, currentImageUrl]);

  useEffect(() => {
    if (!current) return;

    const idx = filteredRows.findIndex((row) => row.__id === current.__id);
    if (idx === -1) return;

    filteredRows.slice(idx + 1, idx + 3).forEach((row) => {
      const url = getImageUrl(row);
      if (url) {
        const preloader = new window.Image();
        preloader.src = url;
      }
    });
  }, [current, filteredRows]);

  const mark = (value, event) => {
    if (!current) return;

    // Nunca marcar una foto que todavia no se ve.
    if (blockDecision) return;

    // Al marcar, la tarea sale del filtro y la siguiente ocupa el mismo lugar
    // debajo del cursor. Sin esta guarda, un doble click marca tambien esa
    // segunda tarea sin que se haya llegado a ver la foto.
    const now = Date.now();
    if (now - lastMarkAt.current < 450) return;
    lastMarkAt.current = now;

    // El boton queda con el foco despues del click: sin esto, la barra
    // espaciadora o Enter lo vuelven a disparar sobre la tarea siguiente.
    if (event && event.currentTarget) event.currentTarget.blur();

    const staysVisible =
      statusFilter === "todos" ||
      (statusFilter === "correctos" && value === "correcto") ||
      (statusFilter === "incorrectos" && value === "incorrecto") ||
      (statusFilter === "fraude" && value === "fraude");

    setLastMark({
      id: current.__id,
      fila: current.__fila_original,
      value,
      previous: decisions[current.__id],
    });

    setDecisions((prev) => ({
      ...prev,
      [current.__id]: value,
    }));

    if (staysVisible && currentIndex < filteredRows.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const undoLastMark = () => {
    if (!lastMark) return;

    setDecisions((prev) => {
      const copy = { ...prev };

      if (lastMark.previous) copy[lastMark.id] = lastMark.previous;
      else delete copy[lastMark.id];

      return copy;
    });

    lastMarkAt.current = 0;
    setLastMark(null);
  };

  const clearDecision = () => {
    if (!current) return;

    setDecisions((prev) => {
      const copy = { ...prev };
      delete copy[current.__id];
      return copy;
    });

    setLastMark(null);
  };

  const exportExcel = () => {
    const candidateIds = new Set(rows.map((row) => row.__id));

    const output = allRows.map((row) => {
      const { __id, __fila_original, ...cleanRow } = row;
      const decision = decisions[__id];

      const clasificacion = !candidateIds.has(__id)
        ? ""
        : decision === "correcto"
        ? "RECLAMAR"
        : decision === "incorrecto"
        ? "NO RECLAMAR"
        : decision === "fraude"
        ? "FRAUDE"
        : "PENDIENTE DE REVISION";

      return {
        ...cleanRow,
        CLASIFICACION_REVISION_MANUAL: clasificacion,
      };
    });

    // Hoja lista para subir a Google Sheets, con las columnas en el orden
    // en que las pide la planilla de reclamos.
    const reclamoRows = rows
      .filter((row) => decisions[row.__id] === "correcto")
      .map((row) => ({
        "FECHA EJECUCION": getExecutionDate(row),
        "POC ID": getPocId(row),
        "DETALLE TAREA": getDetalleTarea(row),
        IMAGEN: getImageUrl(row),
        "ID TAREA": getIdTarea(row),
        DISTRIBUIDOR: getDistribuidor(row),
      }));

    const fraudeRows = rows
      .filter((row) => decisions[row.__id] === "fraude")
      .map((row) => ({
        PROMOTOR: getPromotor(row),
        FECHA_EJECUCION: getExecutionDate(row),
        DISTRIBUIDOR: getDistribuidor(row),
        CLIENTE_POC: getPocId(row),
        TAREA: getDetalleTarea(row),
        IMAGEN: getImageUrl(row),
      }));

    const columnWidths = (data) => {
      if (data.length === 0) return [];

      return Object.keys(data[0]).map((key) => {
        const maxLen = data.reduce((max, row) => {
          const len = String(row[key] ?? "").length;
          return len > max ? len : max;
        }, key.length);

        return { wch: Math.min(Math.max(maxLen + 1, 8), 35) };
      });
    };

    const applyDateFormat = (ws, data, columnNames) => {
      if (data.length === 0) return;

      const headers = Object.keys(data[0]);
      const colIndex = headers.findIndex((h) =>
        columnNames.some((name) => upper(h) === upper(name))
      );
      if (colIndex === -1) return;

      const colLetter = XLSX.utils.encode_col(colIndex);

      data.forEach((_, rowIndex) => {
        const cell = ws[`${colLetter}${rowIndex + 2}`];
        if (cell && cell.t === "n") {
          cell.z = "dd/mm/yyyy";
        }
      });
    };

    const ws = XLSX.utils.json_to_sheet(output);
    ws["!cols"] = columnWidths(output);
    applyDateFormat(ws, output, [
      "Fecha",
      "Fecha Ejecucion",
      "Fecha Ejecución",
      "Dia",
      "Día",
    ]);

    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "revision");

    if (reclamoRows.length > 0) {
      const wsReclamos = XLSX.utils.json_to_sheet(reclamoRows);
      wsReclamos["!cols"] = columnWidths(reclamoRows);
      XLSX.utils.book_append_sheet(wb, wsReclamos, "reclamos");
    }

    if (fraudeRows.length > 0) {
      const wsFraude = XLSX.utils.json_to_sheet(fraudeRows);
      wsFraude["!cols"] = columnWidths(fraudeRows);
      XLSX.utils.book_append_sheet(wb, wsFraude, "fraude");
    }

    XLSX.writeFile(wb, "revision_reclamos_bees_force.xlsx");
  };

  const deleteSavedProgress = () => {
    if (!fileKey) return;

    const confirmDelete = window.confirm(
      "¿Seguro que querés borrar el progreso guardado de este archivo?"
    );

    if (!confirmDelete) return;

    localStorage.removeItem(getStorageKey(fileKey));
    setDecisions({});
    setCurrentIndex(0);
    setStatusFilter("pendientes");
    setPromotorFilter("todos");
    setSearch("");
    setLastSaved("");
    setLastMark(null);
  };

  const total = rows.length;
  const correctos = Object.values(decisions).filter(
    (v) => v === "correcto"
  ).length;
  const incorrectos = Object.values(decisions).filter(
    (v) => v === "incorrecto"
  ).length;
  const fraudes = Object.values(decisions).filter(
    (v) => v === "fraude"
  ).length;
  const pendientes = total - correctos - incorrectos - fraudes;

  const goPrevious = () => {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  };

  const goNext = () => {
    setCurrentIndex((prev) => Math.min(prev + 1, filteredRows.length - 1));
  };

  const resetFilters = () => {
    setStatusFilter("pendientes");
    setPromotorFilter("todos");
    setFechaExcluidas([]);
    setSearch("");
    setCurrentIndex(0);
  };

  const decisionLabel = (decision) => {
    if (decision === "correcto") return "Correcto / reclamar";
    if (decision === "incorrecto") return "Incorrecto / no reclamar";
    if (decision === "fraude") return "Fraude / hablar con promotor";

    return "Pendiente de revisión";
  };

  const getDecisionLabel = () => {
    if (!current) return "Sin selección";

    return decisionLabel(decisions[current.__id]);
  };

  return (
    <div className="app">
      <header className="topHeader">
        <div>
          <span className="eyebrow">Herramienta de revisión manual</span>
          <h1>Analisis Fotos Force</h1>
        </div>

        <label className="uploadButton">
          Cargar Excel
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
        </label>
      </header>

      <section className="panel">
        {fileName ? (
          <p className="file">
            Archivo cargado: {fileName}
            {lastSaved && (
              <span className="savedText">
                {" "}
                · Progreso guardado: {lastSaved}
              </span>
            )}
          </p>
        ) : (
          <p className="file muted">Todavía no cargaste ningún archivo.</p>
        )}

        <div className="stats">
          <Metric label="A revisar" value={total} />
          <Metric label="Correctas / reclamar" value={correctos} tone="good" />
          <Metric label="Incorrectas" value={incorrectos} tone="bad" />
          <Metric label="Fraude" value={fraudes} tone="fraude" />
          <Metric label="Pendientes" value={pendientes} tone="pending" />
          <Metric label="Filtro actual" value={filteredRows.length} />
        </div>

        {rows.length > 0 && (
          <div className="filters">
            <div className="filterGroup searchGroup">
              <label>Buscar</label>
              <input
                type="text"
                placeholder="Cliente, tarea, distribuidor, POC..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentIndex(0);
                }}
              />
            </div>

            <div className="filterGroup">
              <label>Promotor</label>
              <select
                value={promotorFilter}
                onChange={(e) => {
                  setPromotorFilter(e.target.value);
                  setCurrentIndex(0);
                }}
              >
                <option value="todos">Todos los promotores</option>
                {promotores.map((promotor) => (
                  <option key={promotor} value={promotor}>
                    {promotor}
                  </option>
                ))}
              </select>
            </div>

            <div className="filterGroup">
              <label>Fecha</label>
              <details className="multiSelect">
                <summary>{fechaResumen}</summary>
                <div className="multiSelectPanel">
                  <div className="multiSelectActions">
                    <button
                      type="button"
                      onClick={() => {
                        setFechaExcluidas([]);
                        setCurrentIndex(0);
                      }}
                    >
                      Seleccionar todas
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFechaExcluidas([...fechas]);
                        setCurrentIndex(0);
                      }}
                    >
                      Ninguna
                    </button>
                  </div>

                  {fechas.map((fecha) => (
                    <label key={fecha} className="multiSelectOption">
                      <input
                        type="checkbox"
                        checked={!fechaExcluidas.includes(fecha)}
                        onChange={(e) =>
                          toggleFecha(fecha, e.target.checked)
                        }
                      />
                      {fecha}
                    </label>
                  ))}
                </div>
              </details>
            </div>

            <div className="filterGroup">
              <label>Estado revisión</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentIndex(0);
                }}
              >
                <option value="pendientes">Pendientes</option>
                <option value="todos">Todos</option>
                <option value="correctos">Correctas / reclamar</option>
                <option value="incorrectos">Incorrectas</option>
                <option value="fraude">Fraude</option>
              </select>
            </div>

            <button className="softButton" onClick={resetFilters}>
              Limpiar filtros
            </button>

            <button className="warningButton" onClick={deleteSavedProgress}>
              Borrar progreso
            </button>

            <button className="exportButton" onClick={exportExcel}>
              Exportar Excel
            </button>
          </div>
        )}
      </section>

      {current ? (
        <main className="review">
          <section className="imagePanel">
            <div className="imageHeader">
              <div>
                <strong>
                  Imagen {currentPosition} de {total}
                </strong>
                <span>{getDecisionLabel()}</span>
              </div>

              <a href={getImageUrl(current)} target="_blank" rel="noreferrer">
                Abrir imagen original
              </a>
            </div>

            <div className="imageCanvas">
              {imageLoading && (
                <div className="imageLoader">
                  <span className="spinner" />
                  <span>Cargando imagen...</span>
                </div>
              )}

              <img
                key={current.__id}
                src={currentImageUrl}
                alt="Evidencia"
                className={imageLoading ? "imageHidden" : ""}
                onLoad={() => setLoadedImageUrl(currentImageUrl)}
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                  setLoadedImageUrl(currentImageUrl);
                }}
              />
            </div>
          </section>

          <aside className="sidePanel">
            <div className={`stickyBox status-${decisionValue || "pendiente"}`}>
              <div className="statusRow">
                <span className="smallLabel">Estado actual</span>
                <strong>{getDecisionLabel()}</strong>
              </div>

              <div className="mainActions">
                <button
                  className="good"
                  disabled={blockDecision}
                  onClick={(e) => mark("correcto", e)}
                >
                  <span className="btnIcon">✓</span> Correcto / reclamar
                </button>

                <button
                  className="bad"
                  disabled={blockDecision}
                  onClick={(e) => mark("incorrecto", e)}
                >
                  <span className="btnIcon">✕</span> Incorrecto
                </button>

                <button
                  className="fraude"
                  disabled={blockDecision}
                  onClick={(e) => mark("fraude", e)}
                >
                  <span className="btnIcon">⚠</span> Fraude
                </button>
              </div>

              {lastMark && (
                <div className="lastMark">
                  <span>
                    Última marca: fila {lastMark.fila} ·{" "}
                    <strong>{decisionLabel(lastMark.value)}</strong>
                  </span>

                  <button type="button" onClick={undoLastMark}>
                    Deshacer
                  </button>
                </div>
              )}

              <div className="navigationActions">
                <button className="secondary" onClick={goPrevious}>
                  ← Anterior
                </button>

                <button className="secondary" onClick={goNext}>
                  Siguiente →
                </button>

                <button className="secondary full" onClick={clearDecision}>
                  Limpiar marca
                </button>
              </div>

              <div className="infoTitle">Datos de la tarea</div>

              <div className="infoGrid">
                <Info label="Fila Excel" value={current.__fila_original} />

                <Info
                  label="Fecha de ejecución"
                  value={getExecutionDate(current)}
                />

                <Info label="Distribuidor" value={getDistribuidor(current)} />

                <Info label="Promotor" value={getPromotor(current)} />

                <Info label="Cliente / POC" value={getPocId(current)} />

                <Info
                  label="Nombre cliente"
                  value={getColumn(current, [
                    "POC Nombre",
                    "Nombre POC",
                    "cliente_nombre",
                    "nombre cliente",
                  ])}
                />

                <Info label="Tarea" value={getDetalleTarea(current)} wide />

                <Info
                  label="Variable"
                  value={getColumn(current, [
                    "Variable de la Liga",
                    "VARIABLE_DE_LA_LIGA",
                    "variable",
                    "PILAR",
                  ])}
                />

                <Info
                  label="Completada"
                  value={getColumn(current, ["Completada"])}
                />

                <Info
                  label="Validada"
                  value={getColumn(current, ["Validada"])}
                />

                <Info
                  label="Visita válida"
                  value={getColumn(current, [
                    "Visita Valida",
                    "Visita Válida",
                  ])}
                />

                <Info
                  label="Justificación"
                  value={getColumn(current, [
                    "Justificacion",
                    "Justificación",
                  ])}
                  wide
                />
              </div>
            </div>
          </aside>
        </main>
      ) : rows.length > 0 ? (
        <div className="empty">
          No hay registros con ese filtro. Probá cambiar el promotor, el
          buscador o el estado de revisión.
        </div>
      ) : (
        <div className="empty">
          Cargá el archivo Excel para comenzar. La herramienta buscará tareas
          completadas, no validadas, sin justificación, con visita válida e
          imagen disponible.
        </div>
      )}

      <footer className="footerCopyright">
        <p>© Federico Nicolas Wagner</p>
        <p className="contact">
          <a href="mailto:federico.wagner@grupodelorenzi.com">
            federico.wagner@grupodelorenzi.com
          </a>
          <span className="dot">·</span>
          <a href="tel:+5493442476272">+54 9 3442 476272</a>
        </p>
      </footer>
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className={tone ? `tone-${tone}` : undefined}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Info({ label, value, wide }) {
  return (
    <div className={`info${wide ? " wide" : ""}`}>
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

export default App;
