import 'server-only';

import { readFile, statfs } from 'node:fs/promises';
import os from 'node:os';

/* ===========================================================================
 * What the application process can see of the machine it is on.
 *
 * docs/product-decisions.md §10's Server panel wants disk, memory and swap,
 * because "a full disk takes down the database, Docker and the monitoring at
 * once". This is the honest half of that, and the label matters as much as the
 * numbers: THIS IS THE PROCESS'S OWN VIEW, not the host's.
 *
 * Three reasons that is not a quibble:
 *
 *   IN A CONTAINER, `os.totalmem()` IS THE HOST'S. Node reads it from the
 *   kernel and not from the cgroup, so a container limited to 512 MB on a 4 GB
 *   box reports 4 GB. The figure is still useful — it is the machine the
 *   database is on — and it is not "how much memory this app may use".
 *
 *   THE DISK IS THE FILESYSTEM THE WORKING DIRECTORY IS ON, which is the one
 *   the application's own volume lives on and not necessarily the one
 *   PostgreSQL's data directory does.
 *
 *   SWAP IS LINUX-ONLY HERE. Node's `os` has no swap figure at all, so it
 *   comes from /proc/meminfo — and on a machine with no /proc, the panel says
 *   "not available from this process" rather than drawing a zero. §10's rule
 *   about a panel with no writer applies to a figure with no source.
 *
 * Phase 9 is what turns this into monitoring. Until then the dashboard shows
 * what the process knows and says whose view it is.
 *
 * NOTHING HERE OPENS A SOCKET. Two file reads and one system call; the
 * fetch allow-list in tests/markup.test.mjs is untouched by this module.
 * ======================================================================== */

export interface Amount {
  /** Bytes in use. */
  used: number;
  /** Bytes in total, as this process sees them. */
  total: number;
}

export interface ServerStats {
  /** The filesystem the working directory is on, or null if it cannot be read. */
  disk: Amount | null;
  /** The machine's memory as the kernel reports it to this process. */
  memory: Amount;
  /** Swap, from /proc/meminfo. Null everywhere that file does not exist. */
  swap: Amount | null;
  platform: string;
  /** How long this process has been up, in seconds. */
  processUptimeSeconds: number;
  /** How long the machine has been up, in seconds. */
  machineUptimeSeconds: number;
  nodeVersion: string;
}

const MEMINFO = '/proc/meminfo';

/**
 * Read one figure out of /proc/meminfo, in bytes.
 *
 * The file reports kibibytes; every line is `Name:   12345 kB`. A field that
 * is not there is null rather than zero, which is what keeps the panel honest
 * on a kernel that does not report it.
 */
function kibibytes(meminfo: string, field: string): number | null {
  const line = new RegExp(`^${field}:\\s+(\\d+)\\s+kB$`, 'm').exec(meminfo);
  return line ? Number(line[1]) * 1024 : null;
}

async function swapFromProc(): Promise<Amount | null> {
  try {
    const meminfo = await readFile(MEMINFO, 'utf8');
    const total = kibibytes(meminfo, 'SwapTotal');
    const free = kibibytes(meminfo, 'SwapFree');
    if (total === null || free === null) return null;
    return { used: total - free, total };
  } catch {
    // No /proc, or no permission to read it. Both are "this process cannot
    // see swap", which the panel says in words.
    return null;
  }
}

async function diskOfWorkingDirectory(): Promise<Amount | null> {
  try {
    const fs = await statfs(process.cwd());
    const total = Number(fs.blocks) * Number(fs.bsize);
    const free = Number(fs.bavail) * Number(fs.bsize);
    if (!Number.isFinite(total) || total <= 0) return null;
    return { used: total - free, total };
  } catch {
    return null;
  }
}

/** Everything the Server panel draws. One call, no cache: it is a live figure. */
export async function serverStats(): Promise<ServerStats> {
  const [disk, swap] = await Promise.all([diskOfWorkingDirectory(), swapFromProc()]);
  const total = os.totalmem();
  return {
    disk,
    memory: { used: total - os.freemem(), total },
    swap,
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    processUptimeSeconds: Math.round(process.uptime()),
    machineUptimeSeconds: Math.round(os.uptime()),
    nodeVersion: process.version,
  };
}

/** Bytes as a person reads them. Two significant places, and never "0 B" for null. */
export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let n = value;
  let unit = 0;
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000;
    unit += 1;
  }
  return `${n >= 100 || unit === 0 ? Math.round(n) : n.toFixed(1)} ${units[unit]}`;
}

/** A duration in seconds as days and hours, for an uptime. */
export function duration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${hours}h ${minutes}m`;
}
