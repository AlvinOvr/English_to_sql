const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise"); // allow the program to connect to a mysql database
const { GoogleGenAI } = require("@google/genai"); // Import google Gemini client to communicate with the Gemini API

// import the database and Gemini API configuration
// the configurations are found in the config.js file
const { DatabaseConfig, GeminiConfig } = require("./config");

// this class is used to control the AI, database connection, and sql processing
class GeminiSQLBot {

    // constructor runs automatically when a new object for this class is created
    constructor() {

        // checks for the existence of the Gemini AI key
        // if the API key is missing, it displays an error message and stops running
        if (!GeminiConfig.API_KEY || !GeminiConfig.API_KEY.trim()) {
            throw new Error("Please put your Gemini API key in config.js");
        }

        // detects any words that are dangerous to the sql
        // the system is meant to only work with select for now
        this.BAD_WORDS = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i;
    }

    // allows the function init to wait for things like the database connection
    // or AI connection to finish before moving to the next step
    async init() {

        // connects to the sql
        // wait for the connection to be established
        // the database details are gotten from the DatabaseConfig class in config.js
        this.db = await mysql.createConnection({
            host: DatabaseConfig.HOST,
            port: DatabaseConfig.PORT,
            user: DatabaseConfig.USER,
            password: DatabaseConfig.PASSWORD,
            database: DatabaseConfig.DATABASE
        });

        // connect to Gemini, this is done using the API key in GeminiConfig from config.js
        // API key is used to authenticate the program so prompts can be sent to Gemini
        this.ai = new GoogleGenAI({
            apiKey: GeminiConfig.API_KEY
        });

        // calls readTables to get information about the database tables
        // results are saved in tablesText so the AI knows what tables and columns exist in the sql
        this.tablesText = await this.readTables();
    }

    async readTables() {

        // empty list to store the database information
        let lines = [];

        // asks the database for a list of all available tables
        const [tables] = await this.db.query("SHOW TABLES");

        // goes through each table found
        for (let row of tables) {

            // gets name of table
            const tableName = Object.values(row)[0];

            // asks the database for the columns in the table
            const [columns] = await this.db.query(`DESCRIBE \`${tableName}\``);

            // creates a list of the column names
            const columnNames = columns.map(col => col.Field);

            // save the table name and its columns as a line of text
            lines.push(`Table ${tableName}: ${columnNames.join(", ")}`);
        }

        // if the tables were found make them one string
        if (lines.length > 0) {
            return lines.join("\n");
        }

        // return error message if no tables were found
        return "No tables found.";
    }

    fixSQL(text) {
        // if the ai returned nothing use an empty string
        let sql = (text || "").trim();

        // removes any AI formatting that could be around the query
        sql = sql.replace("```sql", "").replace("```", "").trim();

        // if the sql ends with a semicolon, remove it
        if (sql.endsWith(";")) {
            sql = sql.slice(0, -1).trim();
        }

        // return the query
        return sql;
    }

    checkSQL(sql) {
        // if the sql is empty replace it with an empty string and remove any extra spacing
        sql = (sql || "").trim();

        // make sure the query starts with SELECT or WITH
        // if it does not, block the query because it should be read queries only
        if (!/^(select|with)\b/i.test(sql)) {
            return false;
        }

        // block queries that have multiple commands or comments
        if (sql.includes(";") || sql.includes("--") || sql.includes("/*") || sql.includes("#")) {
            return false;
        }

        // if the query has the words marked as dangerous block the query
        if (this.BAD_WORDS.test(sql)) {
            return false;
        }

        return true;
    }

    // LLM SQL safety validator
    async checkSQLWithLLM(sql) {

        const prompt = `
You are a SQL security validator.

Determine if this query is SAFE to run on a database.

SAFE queries:
- SELECT
- WITH
- Read-only queries

UNSAFE queries:
- INSERT
- UPDATE
- DELETE
- DROP
- ALTER
- TRUNCATE
- CREATE
- GRANT
- REVOKE
- Any query that modifies the database

Respond with ONLY one word:
SAFE
or
UNSAFE

SQL:
${sql}
`.trim();

        const response = await this.ai.models.generateContent({
            model: GeminiConfig.MODEL,
            contents: prompt
        });

        const result = response.text.trim().toUpperCase();

        return result === "SAFE";
    }

    makePrompt(question) {

        return `
Convert the question into ONE MySQL SELECT query.

Database schema:
${this.tablesText}

Rules:
- Output ONLY SQL
- No markdown
- No explanation
- Only SELECT queries
- Use only tables and columns from the schema
- Prefer LIMIT 50 if the user did not ask for many rows

Question: ${question}
`.trim();

    }

    // generate SQL only
    async generateSQL(question) {

        const prompt = this.makePrompt(question);

        const response = await this.ai.models.generateContent({
            model: GeminiConfig.MODEL,
            contents: prompt
        });

        const sql = this.fixSQL(response.text);

        // basic rule-based filter
        if (!this.checkSQL(sql)) {
            throw new Error("Blocked by basic SQL filter.");
        }

        // LLM safety check
        const safe = await this.checkSQLWithLLM(sql);

        if (!safe) {
            throw new Error("Blocked: LLM detected unsafe SQL.");
        }

        return sql;
    }

    // run SQL after user presses the run button
    async runSQL(sql) {

        // basic rule-based filter
        if (!this.checkSQL(sql)) {
            throw new Error("Blocked by basic SQL filter.");
        }

        // LLM safety check
        const safe = await this.checkSQLWithLLM(sql);

        if (!safe) {
            throw new Error("Blocked: LLM detected unsafe SQL.");
        }

        const [rows] = await this.db.query(sql);
        return rows;
    }

    async stop() {
        try {
            await this.db.end();
        } catch {}
    }
}

async function startServer() {

    const bot = new GeminiSQLBot();
    await bot.init();

    console.log("English to SQL Bot Started");
    console.log(`Database: ${DatabaseConfig.DATABASE}`);

    console.log("\nDetected Tables:");
    console.log(bot.tablesText);

    const app = express();

    app.use(cors());
    app.use(express.json());
    app.use(express.static(__dirname));

    // generate SQL from English question
    app.post("/api/generate", async function (req, res) {
        try {
            const question = (req.body.question || "").trim();

            if (!question) {
                return res.status(400).json({ error: "Question is required." });
            }

            const sql = await bot.generateSQL(question);
            res.json({ sql });

        } catch (err) {
            console.error("Generate error:", err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // run SQL query
    app.post("/api/run", async function (req, res) {
        try {
            const sql = (req.body.sql || "").trim();

            if (!sql) {
                return res.status(400).json({ error: "SQL is required." });
            }

            const rows = await bot.runSQL(sql);
            res.json({ rows });

        } catch (err) {
            console.error("Run error:", err.message);
            res.status(500).json({ error: err.message });
        }
    });

    const PORT = process.env.PORT || 3000;

    app.listen(PORT, function () {
        console.log(`Server running on port ${PORT}`);
    });
}

startServer().catch(function (err) {
    console.error("Startup error:", err.message);
});