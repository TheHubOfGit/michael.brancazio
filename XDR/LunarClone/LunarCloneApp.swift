import SwiftUI
import AppKit

@main
struct LunarCloneApp: App {
    @StateObject private var monitorManager = MonitorManager()
    @StateObject private var menuBarController = MenuBarController()
    @StateObject private var hotkeyManager = HotkeyManager()
    @StateObject private var adaptiveBrightnessManager = AdaptiveBrightnessManager()
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(monitorManager)
                .environmentObject(menuBarController)
                .environmentObject(hotkeyManager)
                .environmentObject(adaptiveBrightnessManager)
                .frame(minWidth: 800, minHeight: 600)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        
        MenuBarExtra {
            MenuBarView()
                .environmentObject(monitorManager)
                .environmentObject(menuBarController)
                .environmentObject(hotkeyManager)
                .environmentObject(adaptiveBrightnessManager)
        } label: {
            Image(systemName: "display")
                .foregroundColor(.primary)
        }
    }
    
    init() {
        // Hide dock icon and make app run in background
        NSApp.setActivationPolicy(.accessory)
    }
}

struct MenuBarView: View {
    @EnvironmentObject var monitorManager: MonitorManager
    @EnvironmentObject var menuBarController: MenuBarController
    @EnvironmentObject var hotkeyManager: HotkeyManager
    @EnvironmentObject var adaptiveBrightnessManager: AdaptiveBrightnessManager
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                Image(systemName: "display")
                Text("Lunar Clone")
                    .font(.headline)
                Spacer()
                Button("Settings") {
                    NSApp.setActivationPolicy(.regular)
                    NSApp.activate(ignoringOtherApps: true)
                }
                .buttonStyle(.borderless)
            }
            .padding(.horizontal)
            
            Divider()
            
            // Monitor controls
            if monitorManager.connectedMonitors.isEmpty {
                Text("No external monitors detected")
                    .foregroundColor(.secondary)
                    .padding()
            } else {
                ForEach(monitorManager.connectedMonitors) { monitor in
                    MonitorControlRow(monitor: monitor)
                }
            }
            
            Divider()
            
            // Quick actions
            VStack(alignment: .leading, spacing: 8) {
                Button("Refresh Monitors") {
                    monitorManager.refreshMonitors()
                }
                
                Button("Toggle Adaptive Brightness") {
                    adaptiveBrightnessManager.toggleAdaptiveBrightness()
                }
                
                Button("Quit") {
                    NSApplication.shared.terminate(nil)
                }
            }
            .padding(.horizontal)
        }
        .frame(width: 300)
    }
}

struct MonitorControlRow: View {
    let monitor: Monitor
    @EnvironmentObject var monitorManager: MonitorManager
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(monitor.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                Spacer()
                Text("\(Int(monitor.brightness))%")
                    .foregroundColor(.secondary)
            }
            
            // Brightness slider
            HStack {
                Image(systemName: "sun.min")
                    .foregroundColor(.secondary)
                Slider(value: Binding(
                    get: { monitor.brightness },
                    set: { newValue in
                        monitorManager.setBrightness(for: monitor.id, brightness: newValue)
                    }
                ), in: 0...100, step: 1)
                Image(systemName: "sun.max")
                    .foregroundColor(.secondary)
            }
            
            // Volume slider if supported
            if monitor.supportsVolume {
                HStack {
                    Image(systemName: "speaker.fill")
                        .foregroundColor(.secondary)
                    Slider(value: Binding(
                        get: { monitor.volume },
                        set: { newValue in
                            monitorManager.setVolume(for: monitor.id, volume: newValue)
                        }
                    ), in: 0...100, step: 1)
                    Image(systemName: "speaker.wave.3.fill")
                        .foregroundColor(.secondary)
                }
            }
            
            // Input selection
            if !monitor.availableInputs.isEmpty {
                HStack {
                    Text("Input:")
                        .foregroundColor(.secondary)
                    Picker("Input", selection: Binding(
                        get: { monitor.currentInput },
                        set: { newValue in
                            monitorManager.setInput(for: monitor.id, input: newValue)
                        }
                    )) {
                        ForEach(monitor.availableInputs, id: \.self) { input in
                            Text(input).tag(input)
                        }
                    }
                    .pickerStyle(.menu)
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 4)
    }
} 