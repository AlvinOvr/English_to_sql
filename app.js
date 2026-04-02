const englishInput = document.getElementById("english-input");
const sqlOutput = document.getElementById("sql-output");
const clearButton = document.querySelector(".btn-clear");
const generateButton = document.querySelector(".btn-generate");
const runButton = document.querySelector(".btn-run");
const tableContainer = document.querySelector(".table-container");

async function generateSQL() {
    const question = englishInput.value.trim();

    if (!question) {
        alert("Please enter a question first.");
        return;
    }

    sqlOutput.value = "Generating SQL...";
    tableContainer.innerHTML = "";

    try {
        const response = await fetch("/api/generate", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ question })
        });

        const text = await response.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch (error) {
            console.log("Server response:", text);
            throw new Error("Server did not return JSON. Check gemini.js.");
        }

        if (!response.ok) {
            throw new Error(data.error || "Failed to generate SQL.");
        }

        sqlOutput.value = data.sql;
    } catch (error) {
        sqlOutput.value = "";
        tableContainer.innerHTML = "";
        alert(error.message);
    }
}

async function runQuery() {
    const sql = sqlOutput.value.trim();

    if (!sql) {
        alert("Please generate or enter SQL first.");
        return;
    }

    tableContainer.innerHTML = "Running query...";

    try {
        const response = await fetch("/api/run", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ sql })
        });

        const text = await response.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch (error) {
            console.log("Server response:", text);
            throw new Error("Server did not return JSON. Check gemini.js.");
        }

        if (!response.ok) {
            throw new Error(data.error || "Failed to run query.");
        }

        renderTable(data.rows || []);
    } catch (error) {
        tableContainer.innerHTML = "";
        alert(error.message);
    }
}

function renderTable(rows) {
    if (!rows.length) {
        tableContainer.innerHTML = "<p>(no rows)</p>";
        return;
    }

    const columns = Object.keys(rows[0]);

    let html = "<table border='1' cellspacing='0' cellpadding='8'><thead><tr>";

    columns.forEach(function (column) {
        html += `<th>${column}</th>`;
    });

    html += "</tr></thead><tbody>";

    rows.forEach(function (row) {
        html += "<tr>";

        columns.forEach(function (column) {
            html += `<td>${row[column] ?? ""}</td>`;
        });

        html += "</tr>";
    });

    html += "</tbody></table>";
    tableContainer.innerHTML = html;
}

function clearAll() {
    englishInput.value = "";
    sqlOutput.value = "";
    tableContainer.innerHTML = "";
}

clearButton.addEventListener("click", clearAll);
generateButton.addEventListener("click", generateSQL);
runButton.addEventListener("click", runQuery);