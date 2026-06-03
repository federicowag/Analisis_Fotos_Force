import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import "./App.css";

function App() {
  const [rows, setRows] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState({});
  const [fileName, setFileName] = useState("");
  const [statusFilter, setStatusFilter] = useState("pendientes");
  const [promotorFilter, setPromotorFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const [fileKey, setFileKey] = useState("");
  const [lastSaved, setLastSaved] = useState("");

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

    const prepared = json
      .map((row, index) => ({
        ...row,
        __id: `fila-${index}`,
        __fila_original: index + 2,
      }))
      .filter(isCandidate);

    const savedProgress = localStorage.getItem(getStorageKey(newFileKey));

    if (savedProgress) {
      try {
        const parsed = JSON.parse(savedProgress);

        setRows(prepared);
        setDecisions(parsed.decisions || {});
        setCurrentIndex(parsed.currentIndex || 0);
        setStatusFilter(parsed.statusFilter || "pendientes");
        setPromotorFilter(parsed.promotorFilter || "todos");
        setSearch(parsed.search || "");
        setLastSaved(parsed.savedAt || "");
      } catch {
        setRows(prepared);
        setCurrentIndex(0);
        setDecisions({});
        setStatusFilter("pendientes");
        setPromotorFilter("todos");
        setSearch("");
        setLastSaved("");
      }
    } else {
      setRows(prepared);
      setCurrentIndex(0);
      setDecisions({});
      setStatusFilter("pendientes");
      setPromotorFilter("todos");
      setSearch("");
      setLastSaved("");
    }
  };

  useEffect(() => {
    if (!fileKey || rows.length === 0) return;

    const dataToSave = {
      decisions,
      currentIndex,
      statusFilter,
      promotorFilter,
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

  const filteredRows = useMemo(() => {
    const q = upper(search);

    return rows.filter((row) => {
      const decision = decisions[row.__id];
      const promotor = getPromotor(row);

      const matchesStatus =
        statusFilter === "todos" ||
        (statusFilter === "pendientes" && !decision) ||
        (statusFilter === "correctos" && decision === "correcto") ||
        (statusFilter === "incorrectos" && decision === "incorrecto");

      const matchesPromotor =
        promotorFilter === "todos" || promotor === promotorFilter;

      const matchesSearch =
        !q || upper(Object.values(row).join(" ")).includes(q);

      return matchesStatus && matchesPromotor && matchesSearch;
    });
  }, [rows, decisions, statusFilter, promotorFilter, search]);

  const current =
    filteredRows.length > 0
      ? filteredRows[Math.min(currentIndex, filteredRows.length - 1)]
      : null;

  const mark = (value) => {
    if (!current) return;

    setDecisions((prev) => ({
      ...prev,
      [current.__id]: value,
    }));

    if (currentIndex < filteredRows.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const clearDecision = () => {
    if (!current) return;

    setDecisions((prev) => {
      const copy = { ...prev };
      delete copy[current.__id];
      return copy;
    });
  };

  const exportExcel = () => {
    const output = rows.map((row) => {
      const decision = decisions[row.__id] || "pendiente";
      const { __id, ...cleanRow } = row;

      return {
        ...cleanRow,
        FECHA_EJECUCION_DETECTADA: getExecutionDate(row),
        REVISION_MANUAL: decision,
        ACCION_SUGERIDA:
          decision === "correcto"
            ? "RECLAMAR - FOTO BIEN EJECUTADA / POSIBLE FALLO DE ALGORITMO"
            : decision === "incorrecto"
            ? "NO RECLAMAR"
            : "PENDIENTE DE REVISION",
      };
    });

    const ws = XLSX.utils.json_to_sheet(output);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "revision");
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
  };

  const total = rows.length;
  const correctos = Object.values(decisions).filter(
    (v) => v === "correcto"
  ).length;
  const incorrectos = Object.values(decisions).filter(
    (v) => v === "incorrecto"
  ).length;
  const pendientes = total - correctos - incorrectos;

  const goPrevious = () => {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  };

  const goNext = () => {
    setCurrentIndex((prev) => Math.min(prev + 1, filteredRows.length - 1));
  };

  const resetFilters = () => {
    setStatusFilter("pendientes");
    setPromotorFilter("todos");
    setSearch("");
    setCurrentIndex(0);
  };

  const getDecisionLabel = () => {
    if (!current) return "Sin selección";

    const decision = decisions[current.__id];

    if (decision === "correcto") return "Correcto / reclamar";
    if (decision === "incorrecto") return "Incorrecto / no reclamar";

    return "Pendiente de revisión";
  };

  return (
    <div className="app">
      <header className="topHeader">
        <div>
          <span className="eyebrow">Herramienta de revisión manual</span>
          <h1>Analisis_Fotos_Force</h1>
          <p>
            Cargá el Excel, filtrá por promotor y revisá las imágenes
            invalidadas para definir cuáles corresponde reclamar.
          </p>
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
          <Metric label="Correctas / reclamar" value={correctos} />
          <Metric label="Incorrectas" value={incorrectos} />
          <Metric label="Pendientes" value={pendientes} />
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
                  Imagen {Math.min(currentIndex + 1, filteredRows.length)} de{" "}
                  {filteredRows.length}
                </strong>
                <span>{getDecisionLabel()}</span>
              </div>

              <a href={getImageUrl(current)} target="_blank" rel="noreferrer">
                Abrir imagen original
              </a>
            </div>

            <div className="imageCanvas">
              <img
                src={getImageUrl(current)}
                alt="Evidencia"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </div>
          </section>

          <aside className="sidePanel">
            <div className="stickyBox">
              <div className="decisionCard">
                <span className="smallLabel">Estado actual</span>
                <strong>{getDecisionLabel()}</strong>
              </div>

              <div className="mainActions">
                <button className="good" onClick={() => mark("correcto")}>
                  V Correcto / reclamar
                </button>

                <button className="bad" onClick={() => mark("incorrecto")}>
                  X Incorrecto
                </button>
              </div>

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

              <div className="infoBox">
                <h2>Datos de la tarea</h2>

                <Info label="Fila Excel" value={current.__fila_original} />

                <Info
                  label="Fecha de ejecución"
                  value={getExecutionDate(current)}
                />

                <Info
                  label="Distribuidor"
                  value={getColumn(current, [
                    "Distri/Directa",
                    "distribuidor",
                    "DISTRIBUIDOR",
                    "desc_ddc_wh",
                  ])}
                />

                <Info
                  label="Promotor"
                  value={getColumn(current, [
                    "Promotor",
                    "promotor",
                    "PROMOTOR",
                    "ROL_PROMOTOR",
                  ])}
                />

                <Info
                  label="Cliente / POC"
                  value={getColumn(current, [
                    "POC ID",
                    "cliente_id",
                    "cliente",
                    "BdrId",
                    "PDV",
                  ])}
                />

                <Info
                  label="Nombre cliente"
                  value={getColumn(current, [
                    "POC Nombre",
                    "Nombre POC",
                    "cliente_nombre",
                    "nombre cliente",
                  ])}
                />

                <Info
                  label="Tarea"
                  value={getColumn(current, [
                    "Detalle Tarea",
                    "Tarea",
                    "tarea",
                    "TAREA",
                  ])}
                />

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
                  label="Justificación"
                  value={getColumn(current, [
                    "Justificacion",
                    "Justificación",
                  ])}
                />

                <Info
                  label="Visita válida"
                  value={getColumn(current, [
                    "Visita Valida",
                    "Visita Válida",
                  ])}
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
        © Federico Nicolas Wagner
      </footer>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="info">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

export default App;
