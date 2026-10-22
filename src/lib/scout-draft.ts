/** Pure (no Node imports) so the Postings page can use it in the browser. */
/**
 * A draft is only ever opened in YOUR mail app, addressed to YOUR own address; the real recipient is written in the body.
 * Nothing is sent by this code: you read the draft, then forward it yourself.
 */
export function draftMailto(p: { company: string; title: string; recruiter_email: string | null; draft_text: string; url: string }, ownAddress: string): string {
  const body = [
    `DRAFT - not sent. Real recipient: ${p.recruiter_email ?? "(no public recruiter email found - use the posting page or the cegep stage office)"}`,
    `Posting: ${p.url}`,
    "",
    p.draft_text,
  ].join("\n");
  return `mailto:${encodeURIComponent(ownAddress)}?subject=${encodeURIComponent(`[DRAFT] ${p.company} - ${p.title}`)}&body=${encodeURIComponent(body)}`;
}

/** CV facts the mock email may use. Nothing else is ever claimed. */
const CV_SKILLS: [label: string, pattern: RegExp][] = [
  ["C#", /\bc#/i], ["HTML", /\bhtml\b/i], ["CSS", /\bcss\b/i], ["Kotlin", /\bkotlin\b/i], ["SQL", /\bsql\b/i],
  ["TypeScript", /\b(typescript|ts)\b/i], ["JavaScript", /\b(javascript|js)\b/i], ["AJAX", /\bajax\b/i], ["Dart", /\bdart\b/i],
  ["DevOps", /\bdevops\b/i], ["Linux", /\blinux\b/i],
];

export function cvSkillsIn(technologies: string): string[] {
  return CV_SKILLS.filter(([, re]) => re.test(technologies)).map(([label]) => label);
}

const isFrench = (p: { title: string }): boolean => /stag|hiver|développ|ingénieur|programmation|intelligence/i.test(p.title);

/** A deterministic mock email from CV facts only, tailored to the posting's company, role, language and matching skills. */
export function buildDraft(p: { company: string; title: string; technologies: string; recruiter_email: string | null }, contact: string | null): string {
  const skills = cvSkillsIn(p.technologies);
  const joined = (xs: string[], and: string) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}` : xs[0] ?? "");
  if (isFrench(p)) {
    return [
      "Madame, Monsieur,",
      "",
      `Je suis étudiant en Programmation informatique au Cégep Édouard-Montpetit et je souhaite postuler au poste « ${p.title} » chez ${p.company}, pour un stage débutant le 8 mars 2027 et se terminant le 14 mai 2027.`,
      skills.length
        ? `Dans mes cours, j'ai travaillé avec ${joined(skills, "et")}, ce qui correspond aux technologies mentionnées dans votre offre.`
        : "J'ai travaillé en C#, SQL, HTML, CSS, JavaScript, TypeScript, Kotlin et Dart dans mes cours.",
      "Depuis mars 2026, je suis tuteur en programmation au cégep : j'explique des notions techniques de façon simple à d'autres étudiants, ce qui m'aide aussi à bien collaborer en équipe.",
      "Avant l'informatique, j'ai travaillé comme soudeur assembleur, ce qui m'a appris la rigueur, la qualité du travail et le respect des consignes. Je compte poursuivre en génie logiciel à l'université.",
      `Mon CV est en pièce jointe. Je serais heureux de vous rencontrer.${contact ? ` Vous pouvez me joindre à ${contact}.` : ""}`,
      "",
      "Cordialement,",
      "Samuel Rosengarten",
    ].join("\n");
  }
  return [
    "Hello,",
    "",
    `I'm a Computer Programming student at Cégep Édouard-Montpetit applying for the ${p.title} role at ${p.company}, for an internship running March 8 to May 14, 2027.`,
    skills.length
      ? `In my coursework I have worked with ${joined(skills, "and")}, which matches the technologies in your posting.`
      : "In my coursework I have worked with C#, SQL, HTML, CSS, JavaScript, TypeScript, Kotlin and Dart.",
    "Since March 2026 I have been a programming tutor at the cégep, explaining technical ideas in plain language to other students, which also helps me work well in a team.",
    "Before programming I worked as a welder-fitter, which taught me precision and quality of work. I plan to continue in software engineering at university.",
    `My CV is attached and I would be glad to talk.${contact ? ` You can reach me at ${contact}.` : ""}`,
    "",
    "Best regards,",
    "Samuel Rosengarten",
  ].join("\n");
}

/**
 * Opens a ready-to-review message in your mail app, addressed to the recruiter when a public address was found (blank otherwise).
 * Still nothing is sent by this code: you read it, attach your CV and press Send yourself.
 */
export function composeMailto(p: { title: string; company: string; recruiter_email: string | null }, body: string): string {
  const subject = isFrench(p) ? `Candidature de stage - ${p.title}` : `Internship application - ${p.title}`;
  return `mailto:${p.recruiter_email ? encodeURIComponent(p.recruiter_email).replace("%40", "@") : ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Same message as composeMailto, but opened in a Gmail compose window (first signed-in account). You press Send yourself. */
export function gmailCompose(p: { title: string; company: string; recruiter_email: string | null }, body: string): string {
  const q = new URL(composeMailto(p, body).replace(/^mailto:/, "https://x.invalid/?to=").replace("?subject=", "&subject="));
  const params = new URLSearchParams({ view: "cm", fs: "1", tf: "1", to: q.searchParams.get("to") ?? "", su: q.searchParams.get("subject") ?? "", body });
  return `https://mail.google.com/mail/u/0/?${params.toString()}`;
}
