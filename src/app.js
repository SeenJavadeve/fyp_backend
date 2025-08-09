import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"

const app = express()

app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}))

app.use(express.json({limit: "16kb"}))
app.use(express.urlencoded({extended: true, limit: "16kb"}))
app.use(express.static("public"))
app.use(cookieParser())


// routes import
import { API_VERSION_PREFIX } from './utils/constants.js';
import { mainRoutes } from './routes/main.routes.js';


// routes declaration
app.use(API_VERSION_PREFIX, mainRoutes);

// http://localhost:8000/api/v1/mainRoutes

export default app;

