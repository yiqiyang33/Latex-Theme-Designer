import * as path from "node:path";
import * as os from "node:os";
import { describe, expect, it } from "vitest";
import { localProjectNode } from "../src/localNotesTree";
import { localResourceNode, mirrorIdFromArgument, projectIdFromArgument } from "../src/treeNodes";
import type { LocalNoteProjectStatus } from "../src/types";

const project: LocalNoteProjectStatus = {
  id: "project-1",
  rootPath: path.join(os.tmpdir(), "notes", "hw-1-LP"),
  label: "hw-1-LP",
  templateId: "homework-assignment",
  createdAt: "2026-10-01T00:00:00.000Z",
  missing: false
};

describe("tree nodes resolve back to what they show", () => {
  // VS Code passes the node itself to context-menu commands, but the click command's arguments to
  // the click: both have to name the same project.
  it("resolves a Local Notes project from its node and from its click arguments", () => {
    for (const missing of [false, true]) {
      const node = localProjectNode({ ...project, missing }, false);
      expect(projectIdFromArgument(node)).toBe(project.id);
      expect(projectIdFromArgument(node.commandArgs?.[0])).toBe(project.id);
    }
  });

  it("resolves an Overleaf mirror from its node and from its click arguments", () => {
    const node = localResourceNode({
      id: "overleaf-mirror:mirror-1",
      identity: { mirrorId: "mirror-1" },
      label: "Paper",
      iconId: "cloud",
      commandId: "overleafCodex.openLocalMirror",
      contextValue: "overleafMirror"
    });
    expect(mirrorIdFromArgument(node)).toBe("mirror-1");
    expect(mirrorIdFromArgument(node.commandArgs?.[0])).toBe("mirror-1");
    expect(projectIdFromArgument(node)).toBeUndefined();
  });

  it("keeps the project's absolute path out of node data", () => {
    expect(JSON.stringify(localProjectNode(project, true))).not.toContain(project.rootPath);
  });

  it("ignores arguments that carry no id", () => {
    for (const value of [undefined, null, "", "text", 1, {}, { projectId: "" }, { projectId: 7 }]) {
      expect(projectIdFromArgument(value)).toBeUndefined();
      expect(mirrorIdFromArgument(value)).toBeUndefined();
    }
  });
});
