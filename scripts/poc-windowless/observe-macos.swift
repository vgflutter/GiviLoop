// Read-only observer for PoC evidence; not part of the browser implementation.
// Records counts/PIDs only: no window titles, screenshots, or browser content.
import AppKit
import Foundation

let pidsFile = CommandLine.arguments[1]
let stopFile = CommandLine.arguments[2]
var samples = 0
var ownedSamples = 0
var foregroundSamples = 0
var maxOwnedWindows = 0
var maxOnscreenWindows = 0
var observedPids = Set<Int>()
var enumerationFailures = 0
var maxSampleGapMs = 0.0
var previousSample = ProcessInfo.processInfo.systemUptime
print("ready")
fflush(stdout)
while !FileManager.default.fileExists(atPath: stopFile) {
    autoreleasepool {
        let now = ProcessInfo.processInfo.systemUptime
        maxSampleGapMs = max(maxSampleGapMs, (now - previousSample) * 1000)
        previousSample = now
        let text = (try? String(contentsOfFile: pidsFile, encoding: .utf8)) ?? ""
        let pids = Set(text.split(separator: "\n").compactMap { Int($0) })
        let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
        if windows == nil { enumerationFailures += 1 }
        let owned = (windows ?? []).filter { pids.contains(($0[kCGWindowOwnerPID as String] as? Int) ?? -1) }
        let onscreen = owned.filter {
            ($0[kCGWindowIsOnscreen as String] as? Bool) == true &&
            (($0[kCGWindowAlpha as String] as? Double) ?? 1) > 0
        }
        let front = Int(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1)
        if pids.contains(front) { foregroundSamples += 1 }
        let live = pids.filter { kill(pid_t($0), 0) == 0 || errno == EPERM }
        observedPids.formUnion(live)
        if !live.isEmpty { ownedSamples += 1 }
        maxOwnedWindows = max(maxOwnedWindows, owned.count)
        maxOnscreenWindows = max(maxOnscreenWindows, onscreen.count)
        samples += 1
    }
    Thread.sleep(forTimeInterval: 0.02)
}
let result: [String: Any] = [
    "platform": "darwin", "intervalMs": 20, "samples": samples,
    "ownedProcessSamples": ownedSamples, "observedProcessCount": observedPids.count,
    "foregroundSamples": foregroundSamples, "maxOwnedWindows": maxOwnedWindows,
    "maxOnscreenWindows": maxOnscreenWindows, "enumerationFailures": enumerationFailures,
    "maxSampleGapMs": maxSampleGapMs
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
