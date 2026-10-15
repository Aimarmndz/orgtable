// Seeds the demo DB (orgtable_demo) with sample data for the README screenshots.
// Fictional people with @example.com emails (reserved domain). See README.md in this
// folder. Usage: DATABASE_URL=…/orgtable_demo DEMO_PASSWORD=… node seed-demo.mjs
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

// pg, bcryptjs and fractional-indexing come from the project's own dependencies.
const require = createRequire(new URL("../../package.json", import.meta.url));
const pg = require("pg");
const bcrypt = require("bcryptjs");
const { generateNKeysBetween } = require("fractional-indexing");

const url = process.env.DATABASE_URL;
// TRUNCATEs every table: only allowed against the demo DB.
if (!url?.endsWith("/orgtable_demo")) throw new Error("Only against orgtable_demo");
const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error("DEMO_PASSWORD is missing");

const db = new pg.Client({ connectionString: url });
await db.connect();
const id = () => randomUUID().replace(/-/g, "").slice(0, 25);
const q = (sql, params) => db.query(sql, params);

const tables = ["Comment", "CardAssignee", "ChecklistItem", "Checklist", "CardLabel", "Attachment",
  "Card", "Label", "List", "BoardMember", "Board", "Notification", "ApiToken", "AccountToken",
  "Session", "AuditLog", "WorkspaceMember", "Workspace", "User", "InstanceConfig"];
await q(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);

await q(`INSERT INTO "InstanceConfig" (id, "instanceName", "setupCompletedAt", "registrationOpen",
  "operatorName", "operatorEmail", "hostingDescription", "backupRetentionDays", "legalUpdatedAt")
  VALUES ('singleton', 'orgtable', now(), true, 'Example operator', 'privacy@example.com',
  'a server in the European Union', 14, now())`);

const hash = await bcrypt.hash(password, 12);
// Lucía owns the organization "Northwind Studio" (/northwind) and is also the instance
// administrator (for the /admin screenshot); she created the accounts of Marcos (admin),
// Ana and Diego (members). Sofía signed up on her own and owns another organization.
const people = {
  lucia: { name: "Lucía Martín", email: "lucia@example.com", role: "ADMIN", handle: "lucia" },
  marcos: { name: "Marcos Ruiz", email: "marcos@example.com", role: "MEMBER", handle: "marcos" },
  ana: { name: "Ana Torres", email: "ana@example.com", role: "MEMBER", handle: "ana" },
  diego: { name: "Diego Paz", email: "diego@example.com", role: "MEMBER", handle: "diego" },
  sofia: { name: "Sofía Gil", email: "sofia@example.com", role: "MEMBER", handle: "sofia" },
};
for (const p of Object.values(people)) {
  p.id = id();
  p.workspace = id();
  await q(`INSERT INTO "User" (id, email, "passwordHash", name, role, "updatedAt") VALUES ($1,$2,$3,$4,$5,now())`,
    [p.id, p.email, hash, p.name, p.role]);
  await q(`INSERT INTO "Workspace" (id, slug, name, kind, "personalOwnerId", "updatedAt") VALUES ($1,$2,$3,'PERSONAL',$4,now())`,
    [p.workspace, p.handle, p.name, p.id]);
  await q(`INSERT INTO "WorkspaceMember" ("workspaceId","userId",role) VALUES ($1,$2,'OWNER')`, [p.workspace, p.id]);
}

async function organization(slug, name, members, createdAt) {
  const wid = id();
  await q(`INSERT INTO "Workspace" (id, slug, name, kind, "createdAt", "updatedAt") VALUES ($1,$2,$3,'ORGANIZATION',$4,now())`,
    [wid, slug, name, createdAt]);
  for (const [person, role, managed] of members) {
    await q(`INSERT INTO "WorkspaceMember" ("workspaceId","userId",role) VALUES ($1,$2,$3)`, [wid, person.id, role]);
    if (managed) await q(`UPDATE "User" SET "managedById" = $1 WHERE id = $2`, [wid, person.id]);
  }
  return wid;
}

const northwind = await organization("northwind", "Northwind Studio", [
  [people.lucia, "OWNER", false],
  [people.marcos, "ADMIN", true],
  [people.ana, "MEMBER", true],
  [people.diego, "MEMBER", true],
], new Date(Date.UTC(2026, 8, 2)));
await organization("harbor-cafe", "Harbor Café", [[people.sofia, "OWNER", false]], new Date(Date.UTC(2026, 9, 1)));

const day = 86_400_000;
const inDays = (n) => new Date(Date.UTC(2026, 9, 14) + n * day);

async function board({ title, slug, workspace, visibility = "WORKSPACE", background, owner, members, labels, lists }) {
  const boardId = id();
  await q(`INSERT INTO "Board" (id, "ownerId", "workspaceId", slug, visibility, title, background, "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
    [boardId, owner.id, workspace, slug, visibility, title, background]);
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

const { lucia, marcos, ana, diego, sofia } = people;

await board({
  title: "Website launch",
  slug: "website-launch",
  workspace: northwind,
  background: "rose",
  owner: lucia,
  members: [[marcos, "EDITOR"], [ana, "EDITOR"], [diego, "VIEWER"]],
  labels: [["Design", "purple"], ["Development", "blue"], ["Content", "amber"], ["Urgent", "red"], ["SEO", "teal"]],
  lists: [
    { title: "Ideas", cards: [
      { title: "Blog with customer stories", labels: ["Content"] },
      { title: "Dark mode on the landing page", labels: ["Design"] },
      { title: "Monthly newsletter", labels: ["Content"], assignees: [ana] },
    ] },
    { title: "To do", cards: [
      { title: "Pricing page copy", labels: ["Content"], due: 3, assignees: [ana],
        description: "Three plans, friendly tone. Review with Lucía before Friday." },
      { title: "Meta descriptions for every page", labels: ["SEO"], due: 6, assignees: [marcos] },
      { title: "Contact form with validation", labels: ["Development"], assignees: [marcos],
        checklist: { title: "Steps", items: [["Validate on the server", false], ["Accessible error messages", false], ["Test on mobile", false]] } },
    ] },
    { title: "In progress", cards: [
      { title: "Build the home page", labels: ["Development", "Design"], due: 1, assignees: [marcos, lucia],
        description: "Hero, three benefit blocks and testimonials. Mobile-first.",
        checklist: { title: "Sections", items: [["Hero", true], ["Benefits", true], ["Testimonials", false], ["Footer", false]] },
        comments: [[lucia, "The hero is on staging now, can you take a look?", 5], [marcos, "Seen it, tweaking the spacing on mobile.", 2]] },
      { title: "Team photos", labels: ["Design"], due: 2, assignees: [ana] },
    ] },
    { title: "Review", cards: [
      { title: "Palette and typography", labels: ["Design"], assignees: [lucia],
        checklist: { title: "Checklist", items: [["AA contrast", true], ["Dark theme", true]] } },
      { title: "Sitemap and robots.txt", labels: ["SEO", "Development"], due: -1, assignees: [marcos] },
    ] },
    { title: "Done", cards: [
      { title: "Buy the domain", labels: ["Urgent"] },
      { title: "Wireframes", labels: ["Design"], assignees: [lucia, ana] },
    ] },
  ],
});

await board({
  title: "Office move", slug: "office-move", workspace: northwind, visibility: "PRIVATE",
  background: "teal", owner: lucia, members: [[diego, "EDITOR"]],
  labels: [["Suppliers", "amber"], ["IT", "blue"]],
  lists: [
    { title: "To do", cards: [{ title: "Get a quote for the move", labels: ["Suppliers"], due: 9 }] },
    { title: "In progress", cards: [{ title: "Set up fibre at the new office", labels: ["IT"], assignees: [diego] }] },
    { title: "Done", cards: [{ title: "Sign the lease" }] },
  ],
});

await board({
  title: "Q4 content", slug: "q4-content", workspace: northwind,
  background: "amber", owner: ana, members: [[lucia, "EDITOR"]],
  labels: [["Video", "pink"], ["Article", "green"]],
  lists: [
    { title: "Drafts", cards: [{ title: "Getting started guide", labels: ["Article"], assignees: [ana] }] },
    { title: "Published", cards: [{ title: "Product intro video", labels: ["Video"] }] },
  ],
});

await board({
  title: "Personal", slug: "personal", workspace: people.lucia.workspace,
  background: "green", owner: lucia, members: [], labels: [],
  lists: [{ title: "This week", cards: [{ title: "Renew passport", due: 4 }, { title: "Book the dentist" }] }],
});

await board({
  title: "Menu planning", slug: "menu-planning", workspace: (await q(`SELECT id FROM "Workspace" WHERE slug = 'harbor-cafe'`)).rows[0].id,
  background: "blue", owner: sofia, members: [], labels: [],
  lists: [{ title: "Next week", cards: [{ title: "Autumn specials" }] }],
});

await q(`INSERT INTO "Notification" (id,"userId",type,title,body,read,"createdAt") VALUES
  ($1,$2,'card.assigned','You were assigned “Build the home page”','On the board “Website launch”.',false, now() - interval '2 hours'),
  ($3,$2,'comment.added','New comment on “Build the home page”','Seen it, tweaking the spacing on mobile.',false, now() - interval '1 hour')`,
  [id(), lucia.id, id()]);

console.log("Demo seeded:", Object.values(people).map((p) => p.email).join(", "));
await db.end();
