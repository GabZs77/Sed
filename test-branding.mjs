import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("./script.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("./style.css", import.meta.url), "utf8");
const logo = fs.readFileSync(new URL("./sedx-logo.png", import.meta.url));
const share = fs.readFileSync(new URL("./sedx-share.png", import.meta.url));

assert.ok(app.includes('const logoUrl="/sedx-logo.png";'));
assert.ok(app.includes('const logoUrl$1="/sedx-logo.png",headerTextureUrl='));
assert.ok(app.includes('alt:"SEDX Aluno"'));
assert.ok(app.includes('children:"SEDX"'));
assert.ok(app.includes('children:["SEDX "'));
assert.ok(app.includes("Frequência e faltas SEDX"));
assert.ok(!app.includes('children:"SED"'));
assert.ok(!app.includes('children:["SED "'));
assert.ok(css.includes(".login-mark-wrap{background:#000;"));
assert.ok(css.includes(".brand-mark{object-fit:contain;filter:drop-shadow(0 0 13px #71717140);width:62px;height:43px;"));
assert.ok(css.includes(".mobile-brand img{object-fit:contain;width:55px;height:38px;"));
assert.ok(html.includes("<title>SEDX Aluno</title>"));
assert.ok(html.includes('property="og:site_name" content="SEDX Aluno"'));
assert.ok(html.includes('property="og:image" content="https://sed-gg.vercel.app/sedx-share.png"'));
assert.ok(html.includes('name="twitter:image" content="https://sed-gg.vercel.app/sedx-share.png"'));
assert.ok(html.includes('property="og:image:width" content="1200"'));
assert.ok(html.includes('property="og:image:height" content="630"'));
assert.ok(html.includes('property="og:url" content="https://sed-gg.vercel.app/"'));
assert.equal(logo.toString("ascii", 1, 4), "PNG");
assert.equal(share.toString("ascii", 1, 4), "PNG");
assert.equal(share.readUInt32BE(16), 1200);
assert.equal(share.readUInt32BE(20), 630);

console.log("OK: logo SEDX no login e cabeçalhos, marca pública e prévia social estão consistentes.");
