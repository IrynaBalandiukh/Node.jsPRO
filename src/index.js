const app = require("./app");
const pool = require("./db");

const PORT = process.env.PORT || 3000;

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    )
  `);
  await pool.query(`
    INSERT INTO users (name, email)
    SELECT 'Ada Lovelace', 'ada@example.com'
    WHERE NOT EXISTS (SELECT 1 FROM users)
  `);
}

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("failed to initialize database", err);
    process.exit(1);
  });
