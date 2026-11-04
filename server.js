import "dotenv/config";
import { pathToFileURL } from "node:url";
import express from "express";

const app = express();
const port = Number(process.env.PORT || 3000);

app.use("/img", express.static("img"));

export default app;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const startServer = async () => {
    if (process.env.NODE_ENV === "production") {
      app.use(express.static("dist"));
    } else {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
      app.use(vite.middlewares);
    }

    app.listen(port, () => {
      console.log(`Brew Haven running at http://localhost:${port}`);
    });
  };

  startServer().catch((error) => {
    console.error("Brew Haven failed to start.", error);
    process.exitCode = 1;
  });
}
