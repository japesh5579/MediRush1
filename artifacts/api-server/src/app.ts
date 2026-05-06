import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";

const _dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));

app.use("/api", router);

const frontendDist = path.resolve(_dirname, "../../medirush/dist/public");
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.use((_req, res) => res.sendFile(path.join(frontendDist, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err && typeof err === "object" && "issues" in err && Array.isArray((err as any).issues)) {
    const message = (err as any).issues.map((e: any) => e.message).join(", ");
    res.status(400).json({ message });
    return;
  }
  logger.error(err);
  const detail = err instanceof Error ? err.message : String(err);
  res.status(500).json({ message: "Internal server error", detail });
});

export default app;
