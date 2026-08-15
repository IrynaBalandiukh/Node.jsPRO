const express = require("express");
const pool = require("./db");

const app = express();
app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

const usersRouter = express.Router();

usersRouter.get("/", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id, name, email FROM users ORDER BY id");
    res.status(200).json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.use("/users", usersRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});

module.exports = app;
