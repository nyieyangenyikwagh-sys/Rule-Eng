import { buildApp } from "./app.js";
import { readConfig } from "./config.js";
const config = readConfig();
const { app } = await buildApp(config);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ port: config.PORT, host: config.HOST });
