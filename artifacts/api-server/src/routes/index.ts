import { Router, type IRouter } from "express";
import healthRouter from "./health";
import medirushRouter from "./medirush";

const router: IRouter = Router();

router.use(healthRouter);
router.use(medirushRouter);

export default router;
