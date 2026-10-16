import Link from "next/link";
import { ArchitectureDiagram } from "@/components/architecture-diagram";
import { CodeBlock } from "@/components/code-block";
import { CopyButton } from "@/components/copy-button";
import { GitHubIcon } from "@/components/github-icon";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { site } from "@/lib/site";

const sdkSample = `
import { createVer2 } from "@ver2/sdk";
import { S3ObjectStore } from "@ver2/sdk/s3";

const ver2 = createVer2({ store: new S3ObjectStore({ bucket, accountId, credentials }) });

const { versionId } = await ver2.put("docs/report.pdf", bytes);
await ver2.versions.list("docs/report.pdf");
await ver2.versions.restore("docs/report.pdf", versionId);
`;

const cliSample = `
ver2 put docs/report.pdf ./report.pdf
ver2 versions docs/report.pdf
ver2 restore docs/report.pdf <versionId>
`;

const features = [
  {
    title: "Reads don't change",
    body: "Live objects stay at their keys. CDNs, public URLs and presigned GETs keep working, and veR2 is never in the read path.",
  },
  {
    title: "Every write keeps a version",
    body: "Each put, delete and restore keeps an immutable version under a reserved namespace, verified by SHA-256 on download.",
  },
  {
    title: "Crash-safe by design",
    body: "Every write is journaled. An interrupted operation is finished or undone from storage evidence, or flagged instead of guessed.",
  },
];

const guarantees: [string, string, string][] = [
  ["✅", "Concurrent veR2 writers to one key", "Serialized; losers get ConcurrencyConflict"],
  ["✅", "A direct write racing a veR2 write", "Detected; never silently clobbered"],
  ["✅", "Crash mid-operation", "Rolled forward/back from evidence, or flagged OperationIncomplete"],
  ["✅", "Version integrity", "SHA-256 verified on download"],
  ["⚠️", "Direct deletes (outside veR2)", "Cannot be prevented or undone: R2 ignores delete conditions"],
  ["⚠️", "Hot keys", "R2 allows about 1 write/s per key; expect 429s on rapid rewrites"],
  ["⚠️", "Large objects", "Bodies are buffered in memory for now; streaming comes later"],
];

export default function Home() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-24 px-4 py-16 md:py-24">
      <section className="flex flex-col items-start gap-6">
        <Badge variant="secondary">Pre-alpha · 0.x</Badge>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">{site.tagline}</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">{site.description}</p>
        <div className="flex items-center gap-2 rounded-lg border bg-muted py-1 pr-1 pl-4 font-mono text-sm">
          <span>npm i @ver2/sdk</span>
          <CopyButton text="npm i @ver2/sdk" />
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/docs/installation/" className={buttonVariants({ size: "lg" })}>
            Get started
          </Link>
          <a href={site.github} className={buttonVariants({ size: "lg", variant: "outline" })}>
            <GitHubIcon className="size-4" /> GitHub
          </a>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <ArchitectureDiagram className="my-0" />
        <div className="grid gap-4 md:grid-cols-3">
          {features.map((f) => (
            <Card key={f.title}>
              <CardHeader>
                <CardTitle>{f.title}</CardTitle>
                <CardDescription>{f.body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">Use it from code or the terminal</h2>
        <Tabs defaultValue="sdk">
          <TabsList>
            <TabsTrigger value="sdk">SDK</TabsTrigger>
            <TabsTrigger value="cli">CLI</TabsTrigger>
          </TabsList>
          <TabsContent value="sdk">
            <CodeBlock code={sdkSample} lang="ts" />
          </TabsContent>
          <TabsContent value="cli">
            <CodeBlock code={cliSample} lang="bash" />
          </TabsContent>
        </Tabs>
      </section>

      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">Honest guarantees</h2>
          <p className="text-muted-foreground">
            veR2 guarantees what R2 lets it guarantee and documents the rest.{" "}
            <Link href="/docs/guarantees/" className="underline underline-offset-4">
              Read the details
            </Link>
            .
          </p>
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableBody>
              {guarantees.map(([icon, what, how]) => (
                <TableRow key={what}>
                  <TableCell className="w-8">{icon}</TableCell>
                  <TableCell className="font-medium whitespace-normal">{what}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{how}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="flex flex-col items-center gap-4 rounded-xl border bg-muted/40 px-6 py-12 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Start keeping history</h2>
        <p className="max-w-xl text-muted-foreground">Install the SDK, point it at your bucket, and every write is versioned.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/docs/" className={buttonVariants()}>Read the docs</Link>
          <a href={site.npm.sdk} className={buttonVariants({ variant: "outline" })}>View on npm</a>
        </div>
      </section>
    </div>
  );
}
