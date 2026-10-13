export type LeakKind = 'email' | 'ip' | 'hostname' | 'token';
export interface LeakFinding {
    source: string;
    line: number;
    kind: LeakKind;
    match: string;
}
export interface LeakScanTarget {
    source: string;
    content: string;
}
export declare function scanForLeaks(targets: LeakScanTarget[]): LeakFinding[];
export declare function formatLeakFindings(findings: LeakFinding[], limit?: number): string;
//# sourceMappingURL=leakScan.d.ts.map