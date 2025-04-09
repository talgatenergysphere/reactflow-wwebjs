import express from "express";
import cors from "cors";
import FlowController from "./controllers/FlowController.js";
import DebugController from "./controllers/DebugController.js";

export default function expressConnect() {
  const app = express();

  app.use(cors());

  app.use(express.json());

  app.get("/", (req, res) => res.send("Server is up."));

  app.post("/flow/save", FlowController.save);
  app.get("/flow/load", FlowController.load);
  app.get("/debug", DebugController.debug);

  app.listen(process.env.EXPRESS_PORT);
}
