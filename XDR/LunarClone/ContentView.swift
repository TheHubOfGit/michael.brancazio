import SwiftUI

struct ContentView: View {
    @EnvironmentObject var monitorManager: MonitorManager
    @EnvironmentObject var hotkeyManager: HotkeyManager
    @EnvironmentObject var adaptiveBrightnessManager: AdaptiveBrightnessManager
    @State private var selectedTab: Tab = .displays
    
    enum Tab: String, CaseIterable {
        case displays = "Displays"
        case hotkeys = "Hotkeys"
        case adaptive = "Adaptive"
        case settings = "Settings"
        
        var icon: String {
            switch self {
            case .displays: return "display"
            case .hotkeys: return "keyboard"
            case .adaptive: return "sun.max"
            case .settings: return "gear"
            }
        }
    }
    
    var body: some View {
        NavigationSplitView {
            List(Tab.allCases, id: \.self, selection: $selectedTab) { tab in
                NavigationLink(value: tab) {
                    Label(tab.rawValue, systemImage: tab.icon)
                }
            }
            .navigationTitle("Lunar Clone")
            .frame(minWidth: 200)
        } detail: {
            Group {
                switch selectedTab {
                case .displays:
                    DisplaysView()
                case .hotkeys:
                    HotkeysView()
                case .adaptive:
                    AdaptiveView()
                case .settings:
                    SettingsView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationSplitViewStyle(.balanced)
    }
}

struct DisplaysView: View {
    @EnvironmentObject var monitorManager: MonitorManager
    
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 20) {
                ForEach(monitorManager.connectedMonitors) { monitor in
                    MonitorCard(monitor: monitor)
                }
                
                if monitorManager.connectedMonitors.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "display.trianglebadge.exclamationmark")
                            .font(.system(size: 48))
                            .foregroundColor(.secondary)
                        
                        Text("No External Monitors Detected")
                            .font(.title2)
                            .fontWeight(.medium)
                        
                        Text("Connect an external monitor and ensure it supports DDC/CI communication.")
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                        
                        Button("Refresh") {
                            monitorManager.refreshMonitors()
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding(40)
                }
            }
            .padding()
        }
        .navigationTitle("Displays")
        .toolbar {
            Button("Refresh") {
                monitorManager.refreshMonitors()
            }
        }
    }
}

struct MonitorCard: View {
    let monitor: Monitor
    @EnvironmentObject var monitorManager: MonitorManager
    @State private var localBrightness: Double
    @State private var localVolume: Double
    @State private var localContrast: Double
    
    init(monitor: Monitor) {
        self.monitor = monitor
        self._localBrightness = State(initialValue: monitor.brightness)
        self._localVolume = State(initialValue: monitor.volume)
        self._localContrast = State(initialValue: monitor.contrast)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header
            HStack {
                VStack(alignment: .leading) {
                    Text(monitor.name)
                        .font(.title2)
                        .fontWeight(.semibold)
                    
                    Text(monitor.serialNumber)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                VStack(alignment: .trailing) {
                    Text(monitor.isActive ? "Active" : "Inactive")
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(monitor.isActive ? Color.green : Color.red)
                        .foregroundColor(.white)
                        .cornerRadius(4)
                    
                    Text(monitor.connectionType)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            
            // Controls
            VStack(spacing: 16) {
                // Brightness
                ControlSlider(
                    title: "Brightness",
                    icon: "sun.max",
                    value: $localBrightness,
                    range: 0...100
                ) { value in
                    monitorManager.setBrightness(for: monitor.id, brightness: value)
                }
                
                // Contrast
                ControlSlider(
                    title: "Contrast",
                    icon: "circle.lefthalf.fill",
                    value: $localContrast,
                    range: 0...100
                ) { value in
                    monitorManager.setContrast(for: monitor.id, contrast: value)
                }
                
                // Volume (if supported)
                if monitor.supportsVolume {
                    ControlSlider(
                        title: "Volume",
                        icon: "speaker.wave.2",
                        value: $localVolume,
                        range: 0...100
                    ) { value in
                        monitorManager.setVolume(for: monitor.id, volume: value)
                    }
                }
            }
            
            // Input Selection
            if !monitor.availableInputs.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Input Source")
                        .font(.headline)
                    
                    HStack {
                        ForEach(monitor.availableInputs, id: \.self) { input in
                            Button(input) {
                                monitorManager.setInput(for: monitor.id, input: input)
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .foregroundColor(input == monitor.currentInput ? .accentColor : .primary)
                        }
                    }
                }
            }
            
            // Quick Actions
            HStack {
                Button("Black Out") {
                    monitorManager.blackOut(monitor.id)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                
                Button("Reset") {
                    monitorManager.resetMonitor(monitor.id)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                
                Spacer()
                
                Button("Advanced") {
                    // Open advanced settings
                }
                .buttonStyle(.borderless)
                .controlSize(.small)
            }
        }
        .padding()
        .background(Color(.controlBackgroundColor))
        .cornerRadius(12)
        .onReceive(monitorManager.$connectedMonitors) { monitors in
            if let updatedMonitor = monitors.first(where: { $0.id == monitor.id }) {
                localBrightness = updatedMonitor.brightness
                localVolume = updatedMonitor.volume
                localContrast = updatedMonitor.contrast
            }
        }
    }
}

struct ControlSlider: View {
    let title: String
    let icon: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let onValueChanged: (Double) -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(title, systemImage: icon)
                    .font(.headline)
                
                Spacer()
                
                Text("\(Int(value))%")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .monospacedDigit()
            }
            
            Slider(value: $value, in: range, step: 1) { editing in
                if !editing {
                    onValueChanged(value)
                }
            }
        }
    }
}

struct HotkeysView: View {
    @EnvironmentObject var hotkeyManager: HotkeyManager
    
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Keyboard Shortcuts")
                .font(.largeTitle)
                .fontWeight(.bold)
            
            Text("Configure global hotkeys for quick monitor control")
                .foregroundColor(.secondary)
            
            VStack(spacing: 16) {
                HotkeyRow(
                    title: "Increase Brightness",
                    description: "Increase brightness for all monitors",
                    hotkey: hotkeyManager.brightnessUpHotkey,
                    isEnabled: $hotkeyManager.brightnessUpEnabled
                )
                
                HotkeyRow(
                    title: "Decrease Brightness",
                    description: "Decrease brightness for all monitors",
                    hotkey: hotkeyManager.brightnessDownHotkey,
                    isEnabled: $hotkeyManager.brightnessDownEnabled
                )
                
                HotkeyRow(
                    title: "Increase Volume",
                    description: "Increase volume for all monitors",
                    hotkey: hotkeyManager.volumeUpHotkey,
                    isEnabled: $hotkeyManager.volumeUpEnabled
                )
                
                HotkeyRow(
                    title: "Decrease Volume",
                    description: "Decrease volume for all monitors",
                    hotkey: hotkeyManager.volumeDownHotkey,
                    isEnabled: $hotkeyManager.volumeDownEnabled
                )
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct HotkeyRow: View {
    let title: String
    let description: String
    let hotkey: String
    @Binding var isEnabled: Bool
    
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                
                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            Text(hotkey)
                .font(.system(.body, design: .monospaced))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color(.controlBackgroundColor))
                .cornerRadius(6)
            
            Toggle("", isOn: $isEnabled)
                .toggleStyle(.switch)
        }
        .padding()
        .background(Color(.controlBackgroundColor))
        .cornerRadius(8)
    }
}

struct AdaptiveView: View {
    @EnvironmentObject var adaptiveBrightnessManager: AdaptiveBrightnessManager
    
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Adaptive Brightness")
                .font(.largeTitle)
                .fontWeight(.bold)
            
            Text("Automatically adjust monitor brightness based on various conditions")
                .foregroundColor(.secondary)
            
            VStack(spacing: 20) {
                AdaptiveModeCard(
                    title: "Sync Mode",
                    description: "Sync with built-in display brightness",
                    icon: "laptopcomputer.and.arrow.down",
                    isEnabled: $adaptiveBrightnessManager.syncModeEnabled
                )
                
                AdaptiveModeCard(
                    title: "Sensor Mode",
                    description: "Use external light sensor",
                    icon: "sensor.fill",
                    isEnabled: $adaptiveBrightnessManager.sensorModeEnabled
                )
                
                AdaptiveModeCard(
                    title: "Location Mode",
                    description: "Based on sunrise/sunset times",
                    icon: "location.fill",
                    isEnabled: $adaptiveBrightnessManager.locationModeEnabled
                )
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AdaptiveModeCard: View {
    let title: String
    let description: String
    let icon: String
    @Binding var isEnabled: Bool
    
    var body: some View {
        HStack {
            Image(systemName: icon)
                .font(.system(size: 24))
                .foregroundColor(.accentColor)
                .frame(width: 40)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                
                Text(description)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            Toggle("", isOn: $isEnabled)
                .toggleStyle(.switch)
        }
        .padding()
        .background(Color(.controlBackgroundColor))
        .cornerRadius(12)
    }
}

struct SettingsView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Settings")
                .font(.largeTitle)
                .fontWeight(.bold)
            
            Text("General application settings")
                .foregroundColor(.secondary)
            
            VStack(spacing: 16) {
                SettingRow(
                    title: "Launch at Login",
                    description: "Start Lunar Clone when you log in",
                    control: AnyView(Toggle("", isOn: .constant(false)).toggleStyle(.switch))
                )
                
                SettingRow(
                    title: "Hide Menu Bar Icon",
                    description: "Hide the menu bar icon when not needed",
                    control: AnyView(Toggle("", isOn: .constant(false)).toggleStyle(.switch))
                )
                
                SettingRow(
                    title: "DDC Polling Interval",
                    description: "How often to check monitor status",
                    control: AnyView(
                        Picker("", selection: .constant(5)) {
                            Text("1 second").tag(1)
                            Text("5 seconds").tag(5)
                            Text("10 seconds").tag(10)
                            Text("30 seconds").tag(30)
                        }
                        .pickerStyle(.menu)
                    )
                )
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct SettingRow: View {
    let title: String
    let description: String
    let control: AnyView
    
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                
                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            control
        }
        .padding()
        .background(Color(.controlBackgroundColor))
        .cornerRadius(8)
    }
}

#Preview {
    ContentView()
        .environmentObject(MonitorManager())
        .environmentObject(MenuBarController())
        .environmentObject(HotkeyManager())
        .environmentObject(AdaptiveBrightnessManager())
} 