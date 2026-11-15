"use client";

import { useEffect, useState } from "react";
import { SOURCE_LABEL } from "@/components/site/Navbar";
import { useLabStore } from "@/store/lab-store";

interface Tally {
  requests: number;
  hosts: Map<string, number>;
}

/**
 * The browser's own record of what this tab has fetched (the Resource Timing API), grouped by host.
 * Turn the microphone on and the list does not grow: there is nothing uploading.
 */
export function HostsMeter() {
  const [tally, setTally] = useState<Tally | null>(null);
  const sourceMode = useLabStore((s) => s.sourceMode);

  useEffect(() => {
    const hosts = new Map<string, number>();
    let requests = 0;
    const add = (entries: PerformanceEntryList) => {
      for (const entry of entries) {
        let host = "this page";
        try {
          host = new URL(entry.name).host;
        } catch {
          /* a data: or blob: entry, made inside the tab */
        }
        hosts.set(host, (hosts.get(host) ?? 0) + 1);
        requests++;
      }
      setTally({ requests, hosts: new Map(hosts) });
    };
    add([...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")]);
    const observer = new PerformanceObserver((list) => add(list.getEntries()));
    observer.observe({ type: "resource", buffered: false });
    return () => observer.disconnect();
  }, []);

  const here = typeof window === "undefined" ? "" : window.location.host;
  const others = tally ? [...tally.hosts.keys()].filter((h) => h !== here && h !== "this page") : [];

  return (
    <div data-ui className="ui-panel">
      <p className="flex min-h-10 items-center justify-between gap-4 border-b border-line px-3">
        <span className="text-[13px] font-medium text-ink">What this tab has fetched</span>
        <span className="ui-label">{SOURCE_LABEL[sourceMode]}</span>
      </p>
      <dl className="px-3 py-2">
        {tally ? (
          [...tally.hosts.entries()].map(([host, count]) => (
            <div key={host} className="flex min-h-8 items-center justify-between gap-6">
              <dt className="ui-fig text-[13px] text-ink">{host}</dt>
              <dd className="ui-fig text-[13px] text-ink">
                {count} <span className="text-muted">{count === 1 ? "request" : "requests"}</span>
              </dd>
            </div>
          ))
        ) : (
          <div className="flex min-h-8 items-center">
            <dt className="ui-label">Reading the browser&rsquo;s log.</dt>
          </div>
        )}
      </dl>
      <p className="border-t border-line px-3 py-2.5 text-[13px] text-ink" aria-live="polite">
        {!tally
          ? "This list needs script to run."
          : others.length === 0
            ? `${tally.requests} requests, all to this site: pages, type, pictures. None carries audio.`
            : `${tally.requests} requests. Hosts other than this site: ${others.join(", ")}.`}
      </p>
    </div>
  );
}
