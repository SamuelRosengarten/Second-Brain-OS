// Minimal stand-in for Ollama so UI tests are deterministic and need no GPU or model download.
import http from "node:http";

const port = Number(process.env.FAKE_OLLAMA_PORT || 11500);

const proposal = {
  title: "E2E tomato garden",
  summary: "Plan a tomato garden.",
  category: "idea",
  tags: ["garden", "tomato"],
  related_projects: [],
  next_action: "Buy cedar boards",
  open_questions: ["Where exactly?"],
  confidence: "medium",
  uncertainty: "Location not given.",
  note_markdown: "## Summary\nPlan a tomato garden with cedar boards.\n\n## Next action\nBuy cedar boards",
};

const vec = (text) => {
  const v = new Array(16).fill(0);
  for (const w of String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 0;
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 16;
    v[h] += 1;
  }
  return v;
};

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => resolve(b ? JSON.parse(b) : {}));
  });

http
  .createServer(async (req, res) => {
    const body = req.method === "POST" ? await readBody(req) : {};
    const json = (o) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(o));
    };
    if (req.url === "/api/tags") return json({ models: [{ name: "fake-chat", size: 1e9 }, { name: "fake-embed", size: 1e8 }] });
    if (req.url === "/api/show") return json({ capabilities: ["completion"] });
    if (req.url === "/api/embed") return json({ embeddings: (body.input ?? []).map(vec) });
    if (req.url === "/api/chat") {
      if (body.stream === false) {
        const sys = body.messages?.[0]?.content ?? "";
        // Dependency suggestions: always propose T1 before T2 with a reason; task suggestions: two plain tasks.
        if (sys.includes("hidden ordering between tasks")) return json({ message: { role: "assistant", content: JSON.stringify({ links: [{ first: "T1", then: "T2", confidence: 88, reason: "The second task needs the first one's result." }, { first: "T3", then: "T4", confidence: 55, reason: "Weak hint only." }] }) } });
        if (sys.includes("plan work in their personal task system")) return json({ message: { role: "assistant", content: JSON.stringify({ tasks: [{ title: "Draft the outline", description: "", priority: "high", due_date: "", project: "" }, { title: "Review the draft", description: "", priority: "medium", due_date: "", project: "" }] }) } });
        return json({ message: { role: "assistant", content: JSON.stringify(proposal) } });
      }
      const system = body.messages?.[0]?.content ?? "";
      const grounded = system.includes("LIBRARY PASSAGES");
      const text = grounded ? "Based on your notes, buy cedar boards [1]." : "Plain local reply.";
      res.setHeader("content-type", "application/x-ndjson");
      for (const part of text.match(/.{1,12}/g)) res.write(JSON.stringify({ message: { role: "assistant", content: part }, done: false }) + "\n");
      return res.end(JSON.stringify({ message: { role: "assistant", content: "" }, done: true }) + "\n");
    }
    res.statusCode = 404;
    res.end("not found");
  })
  .listen(port, "127.0.0.1", () => console.log(`fake ollama on ${port}`));
