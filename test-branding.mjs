import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("./script.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("./style.css", import.meta.url), "utf8");
const logo = fs.readFileSync(new URL("./sedx-logo.png", import.meta.url));
const share = fs.readFileSync(new URL("./sedx-share.png", import.meta.url));

assert.ok(app.includes('const logoUrl="/sedx-logo.png";'));
assert.ok(app.includes('alt:"SedX — SED Aluno"'));
assert.ok(css.includes(".login-mark-wrap{background:#000;"));
assert.ok(css.includes(".login-mark-wrap img{object-fit:contain;width:100%;height:100%}"));
assert.ok(html.includes('property="og:image" content="https://sed-gg.vercel.app/sedx-share.png"'));
assert.ok(html.includes('name="twitter:image" content="https://sed-gg.vercel.app/sedx-share.png"'));
assert.ok(html.includes('property="og:image:width" content="1200"'));
assert.ok(html.includes('property="og:image:height" content="630"'));
assert.equal(logo.toString("ascii", 1, 4), "PNG");
assert.equal(share.toString("ascii", 1, 4), "PNG");
assert.equal(share.readUInt32BE(16), 1200);
assert.equal(share.readUInt32BE(20), 630);

console.log("OK: logo do login e prévia social SedX estão configurados e os assets estão válidos.");
