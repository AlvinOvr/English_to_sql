const DatabaseConfig = {
    HOST: process.env.DB_HOST,
    PORT: Number(process.env.DB_PORT || 3306),
    USER: process.env.DB_USER,
    PASSWORD: process.env.DB_PASSWORD,
    DATABASE: process.env.DB_NAME
};

const GeminiConfig = {
    API_KEY: "AIzaSyDBUJUrZcfjDj86kHSMPo00UniDBH4IGA4",
    MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash"
};

module.exports = { DatabaseConfig, GeminiConfig };
