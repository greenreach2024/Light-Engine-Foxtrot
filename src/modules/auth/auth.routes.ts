import { Router } from "express";
import { authController } from "./auth.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { registerSchema, loginSchema } from "./auth.validation.js";

export const authRouter = Router();

authRouter.post("/register", validate({ body: registerSchema }), authController.register);
authRouter.post("/login", validate({ body: loginSchema }), authController.login);
authRouter.get("/me", authenticate, authController.me);
