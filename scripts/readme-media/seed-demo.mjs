// Siembra la BD de demo (orgtable_demo) con datos de ejemplo para las capturas del README.
// Personas ficticias con emails @example.com (dominio reservado). Ver README.md de esta
// carpeta. Uso: DATABASE_URL=…/orgtable_demo DEMO_PASSWORD=… node seed-demo.mjs
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

// pg, bcryptjs y fractional-indexing salen de las dependencias del propio proyecto.
const require = createRequire(new URL("../../package.json", import.meta.url));
const pg = require("pg");
const bcrypt = require("bcryptjs");
const { generateNKeysBetween } = require("fractional-indexing");

const url = process.env.DATABASE_URL;
// TRUNCATE de todas las tablas: solo se permite contra la BD de demo.
if (!url?.endsWith("/orgtable_demo")) throw new Error("Solo contra orgtable_demo");
const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error("Falta DEMO_PASSWORD");

const db = new pg.Client({ connectionString: url });
await db.connect();
const id = () => randomUUID().replace(/-/g, "").slice(0, 25);
const q = (sql, params) => db.query(sql, params);

const tables = ["Comment", "CardAssignee", "ChecklistItem", "Checklist", "CardLabel", "Attachment",
  "Card", "Label", "List", "BoardMember", "Board", "Notification", "ApiToken", "Session",
  "AuditLog", "User", "InstanceConfig"];
await q(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);

await q(`INSERT INTO "InstanceConfig" (id, "instanceName", "setupCompletedAt", "registrationOpen",
  "operatorName", "operatorEmail", "hostingDescription", "backupRetentionDays", "legalUpdatedAt")
  VALUES ('singleton', 'orgtable', now(), true, 'Operador de ejemplo', 'privacidad@example.com',
  'un servidor en la Unión Europea', 14, now())`);

const hash = await bcrypt.hash(password, 12);
const people = {
  lucia: { name: "Lucía Martín", email: "lucia@example.com", role: "ADMIN" },
  marcos: { name: "Marcos Ruiz", email: "marcos@example.com", role: "MEMBER" },
  ana: { name: "Ana Torres", email: "ana@example.com", role: "MEMBER" },
  diego: { name: "Diego Paz", email: "diego@example.com", role: "MEMBER" },
};
for (const p of Object.values(people)) {
  p.id = id();
  await q(`INSERT INTO "User" (id, email, "passwordHash", name, role, "updatedAt") VALUES ($1,$2,$3,$4,$5,now())`,
    [p.id, p.email, hash, p.name, p.role]);
}

const day = 86_400_000;
const inDays = (n) => new Date(Date.UTC(2026, 9, 14) + n * day);

async function board({ title, background, owner, members, labels, lists }) {
  const boardId = id();
  await q(`INSERT INTO "Board" (id, "ownerId", title, background, "updatedAt") VALUES ($1,$2,$3,$4,now())`,
    [boardId, owner.id, title, background]);
  await q(`INSERT INTO "BoardMember" ("boardId","userId",role) VALUES ($1,$2,'OWNER')`, [boardId, owner.id]);
  for (const [m, role] of members) {
    await q(`INSERT INTO "BoardMember" ("boardId","userId",role) VALUES ($1,$2,$3)`, [boardId, m.id, role]);
  }
  const labelIds = {};
  for (const [name, color] of labels) {
    labelIds[name] = id();
    await q(`INSERT INTO "Label" (id,"boardId",name,color) VALUES ($1,$2,$3,$4)`, [labelIds[name], boardId, name, color]);
  }
  const listKeys = generateNKeysBetween(null, null, lists.length);
  for (const [li, list] of lists.entries()) {
    const listId = id();
    await q(`INSERT INTO "List" (id,"boardId",title,position,"updatedAt") VALUES ($1,$2,$3,$4,now())`,
      [listId, boardId, list.title, listKeys[li]]);
    const cardKeys = generateNKeysBetween(null, null, list.cards.length);
    for (const [ci, c] of list.cards.entries()) {
      const cardId = id();
      await q(`INSERT INTO "Card" (id,"listId",title,description,position,"dueDate","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())`,
        [cardId, listId, c.title, c.description ?? null, cardKeys[ci], c.due == null ? null : inDays(c.due)]);
      for (const l of c.labels ?? []) {
        await q(`INSERT INTO "CardLabel" ("cardId","labelId") VALUES ($1,$2)`, [cardId, labelIds[l]]);
      }
      for (const a of c.assignees ?? []) {
        await q(`INSERT INTO "CardAssignee" ("cardId","userId") VALUES ($1,$2)`, [cardId, a.id]);
      }
      if (c.checklist) {
        const chId = id();
        await q(`INSERT INTO "Checklist" (id,"cardId",title,position) VALUES ($1,$2,$3,'a0')`, [chId, cardId, c.checklist.title]);
        const itemKeys = generateNKeysBetween(null, null, c.checklist.items.length);
        for (const [ii, [text, done]] of c.checklist.items.entries()) {
          await q(`INSERT INTO "ChecklistItem" (id,"checklistId",text,done,position) VALUES ($1,$2,$3,$4,$5)`,
            [id(), chId, text, done, itemKeys[ii]]);
        }
      }
      for (const [author, text, ago] of c.comments ?? []) {
        await q(`INSERT INTO "Comment" (id,"cardId","authorId",text,"createdAt") VALUES ($1,$2,$3,$4,$5)`,
          [id(), cardId, author.id, text, new Date(Date.now() - ago * 3_600_000)]);
      }
    }
  }
  return boardId;
}

const { lucia, marcos, ana, diego } = people;

await board({
  title: "Lanzamiento de la web",
  background: "rose",
  owner: lucia,
  members: [[marcos, "EDITOR"], [ana, "EDITOR"], [diego, "VIEWER"]],
  labels: [["Diseño", "purple"], ["Desarrollo", "blue"], ["Contenido", "amber"], ["Urgente", "red"], ["SEO", "teal"]],
  lists: [
    { title: "Ideas", cards: [
      { title: "Blog con casos de clientes", labels: ["Contenido"] },
      { title: "Modo oscuro en la landing", labels: ["Diseño"] },
      { title: "Newsletter mensual", labels: ["Contenido"], assignees: [ana] },
    ] },
    { title: "Por hacer", cards: [
      { title: "Textos de la página de precios", labels: ["Contenido"], due: 3, assignees: [ana],
        description: "Tres planes, tono cercano. Revisar con Lucía antes del viernes." },
      { title: "Meta descripciones de cada página", labels: ["SEO"], due: 6, assignees: [marcos] },
      { title: "Formulario de contacto con validación", labels: ["Desarrollo"], assignees: [marcos],
        checklist: { title: "Pasos", items: [["Validar en el servidor", false], ["Mensajes de error accesibles", false], ["Prueba en móvil", false]] } },
    ] },
    { title: "En curso", cards: [
      { title: "Maquetar la home", labels: ["Desarrollo", "Diseño"], due: 1, assignees: [marcos, lucia],
        description: "Hero, tres bloques de beneficios y testimonios. Mobile-first.",
        checklist: { title: "Secciones", items: [["Hero", true], ["Beneficios", true], ["Testimonios", false], ["Pie", false]] },
        comments: [[lucia, "El hero ya está en staging, ¿lo revisas?", 5], [marcos, "Visto, ajusto el espaciado en móvil.", 2]] },
      { title: "Fotos del equipo", labels: ["Diseño"], due: 2, assignees: [ana] },
    ] },
    { title: "Revisión", cards: [
      { title: "Paleta y tipografías", labels: ["Diseño"], assignees: [lucia],
        checklist: { title: "Checklist", items: [["Contraste AA", true], ["Tema oscuro", true]] } },
      { title: "Sitemap y robots.txt", labels: ["SEO", "Desarrollo"], due: -1, assignees: [marcos] },
    ] },
    { title: "Hecho", cards: [
      { title: "Comprar el dominio", labels: ["Urgente"] },
      { title: "Wireframes", labels: ["Diseño"], assignees: [lucia, ana] },
    ] },
  ],
});

await board({
  title: "Mudanza de oficina", background: "teal", owner: lucia, members: [[diego, "EDITOR"]],
  labels: [["Proveedores", "amber"], ["IT", "blue"]],
  lists: [
    { title: "Por hacer", cards: [{ title: "Pedir presupuesto de la mudanza", labels: ["Proveedores"], due: 9 }] },
    { title: "En curso", cards: [{ title: "Contratar fibra en la nueva oficina", labels: ["IT"], assignees: [diego] }] },
    { title: "Hecho", cards: [{ title: "Firmar el contrato de alquiler" }] },
  ],
});

await board({
  title: "Contenido del cuarto trimestre", background: "amber", owner: ana, members: [[lucia, "EDITOR"]],
  labels: [["Vídeo", "pink"], ["Artículo", "green"]],
  lists: [
    { title: "Borradores", cards: [{ title: "Guía de primeros pasos", labels: ["Artículo"], assignees: [ana] }] },
    { title: "Publicado", cards: [{ title: "Vídeo de presentación", labels: ["Vídeo"] }] },
  ],
});

await board({
  title: "Personal", background: "green", owner: lucia, members: [], labels: [],
  lists: [{ title: "Esta semana", cards: [{ title: "Renovar el pasaporte", due: 4 }, { title: "Reservar el dentista" }] }],
});

await q(`INSERT INTO "Notification" (id,"userId",type,title,body,read,"createdAt") VALUES
  ($1,$2,'card.assigned','Marcos te asignó «Maquetar la home»','Lanzamiento de la web',false, now() - interval '2 hours'),
  ($3,$2,'comment.added','Nuevo comentario en «Maquetar la home»','Marcos: Visto, ajusto el espaciado en móvil.',false, now() - interval '1 hour')`,
  [id(), lucia.id, id()]);

console.log("Demo sembrada:", Object.values(people).map((p) => p.email).join(", "));
await db.end();
