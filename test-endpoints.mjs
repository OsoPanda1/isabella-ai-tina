import("./.vercel/output/functions/__server.func/index.mjs")
  .then(async (m) => {
    const d = m.default;
    if (d && typeof d.fetch === "function") {
      for (const ep of [
        "/api/health/live",
        "/api/health/ready",
        "/api/health/deep",
        "/api/isabella",
      ]) {
        const res = await d.fetch(new Request("https://test.local" + ep), {});
        console.log(ep, "->", res.status, res.headers.get("content-type"));
        if (ep === "/api/isabella") {
          const t = await res.text();
          console.log(t.slice(0, 500));
        }
      }
    }
  })
  .catch((e) => console.log("FAIL:", e.message));
