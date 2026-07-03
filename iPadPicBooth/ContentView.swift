import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ContentView: View {
    @EnvironmentObject private var camera: CameraController

    @AppStorage("booth.eventName") private var eventName = "Your Event"
    @AppStorage("booth.eventDate") private var eventDate = ""
    @AppStorage("booth.message") private var message = "一起记录这一刻"
    @AppStorage("booth.countdownSeconds") private var countdownSeconds = 3
    @AppStorage("booth.templateID") private var templateID = BoothTemplate.builtIn[0].id
    @AppStorage("booth.customTemplates") private var customTemplatesJSON = "[]"
    @AppStorage("booth.customTemplate") private var legacyCustomTemplateJSON = ""

    @State private var selectedTemplate = BoothTemplate.builtIn[0]
    @State private var capturedPhotos: [UIImage] = []
    @State private var finalImage: UIImage?
    @State private var countdown: Int?
    @State private var currentShot = 0
    @State private var isRunningSession = false
    @State private var statusMessage = ""
    @State private var isShowingSettings = false
    @State private var isShowingShareSheet = false
    @State private var isTemplatePanelCollapsed = true
    @State private var isShowingTemplateDesigner = false
    @State private var designerSeedTemplate = BoothTemplate.builtIn[0]

    private let previewAspect: CGFloat = 1.5

    var body: some View {
        ZStack {
            blushBackground

            VStack(spacing: 12) {
                header
                workspace
                bottomStatus
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
        }
        .preferredColorScheme(.light)
        .onAppear(perform: restoreTemplate)
        .onChange(of: templateID) { _, _ in restoreTemplate() }
        .sheet(isPresented: $isShowingSettings) { settingsView }
        .sheet(isPresented: $isShowingShareSheet) {
            if let finalImage {
                ShareSheet(items: [finalImage])
            }
        }
        .sheet(isPresented: $isShowingTemplateDesigner) {
            TemplateDesignerView(
                template: designerSeedTemplate,
                eventName: eventName,
                eventDate: eventDate,
                message: message
            ) { template in
                storeCustomTemplate(template)
                selectedTemplate = template
                templateID = template.id
                isShowingTemplateDesigner = false
                resetSession()
            }
        }
    }

    private var blushBackground: some View {
        ZStack {
            Color(red: 1.0, green: 0.93, blue: 0.96).ignoresSafeArea()
            Circle()
                .fill(Color.white.opacity(0.65))
                .frame(width: 420, height: 420)
                .blur(radius: 24)
                .offset(x: -470, y: -250)
            Circle()
                .fill(Color(red: 1.0, green: 0.78, blue: 0.86).opacity(0.42))
                .frame(width: 520, height: 520)
                .blur(radius: 34)
                .offset(x: 500, y: 310)
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text("CELEBRATE · LAUGH · LOVE")
                    .font(.caption.weight(.semibold))
                    .tracking(2.6)
                    .foregroundStyle(Color.deepPink.opacity(0.75))
                HStack(spacing: 9) {
                    Text("Pic")
                        .font(.system(size: 31, weight: .regular, design: .serif))
                    Text("Booth")
                        .font(.system(size: 31, weight: .bold, design: .rounded))
                    Text("by KJ")
                        .font(.caption.weight(.bold))
                        .tracking(0.8)
                        .foregroundStyle(Color.deepPink.opacity(0.78))
                    Text("♡")
                        .font(.system(size: 31, weight: .bold))
                        .foregroundStyle(Color.deepPink)
                    Text(eventName)
                        .font(.system(size: 23, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.roseText)
                        .lineLimit(1)
                }
            }

            Spacer()

            cameraPill

            Button {
                isShowingSettings = true
            } label: {
                Label("设置", systemImage: "gearshape.fill")
            }
            .buttonStyle(PillButtonStyle(filled: false))
        }
    }

    private var cameraPill: some View {
        Label(camera.isReady ? camera.cameraName : "等待 OTG 相机", systemImage: camera.isReady ? "camera.fill" : "camera")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(camera.isReady ? Color.green : Color.orange)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.white.opacity(0.78), in: Capsule())
            .overlay(Capsule().stroke(.white, lineWidth: 1))
    }

    private var workspace: some View {
        HStack(spacing: 18) {
            if isTemplatePanelCollapsed {
                collapsedTemplateRail
                    .frame(width: 58)
            } else {
                templatePicker
                    .frame(width: 255)
            }

            VStack(spacing: 12) {
                previewStage
                mainActions
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .animation(.snappy(duration: 0.25), value: isTemplatePanelCollapsed)
    }

    private var collapsedTemplateRail: some View {
        VStack(spacing: 14) {
            Button {
                isTemplatePanelCollapsed = false
            } label: {
                Image(systemName: "rectangle.stack.fill")
                    .font(.title2)
                    .foregroundStyle(Color.deepPink)
                    .frame(width: 44, height: 44)
                    .background(.white.opacity(0.84), in: Circle())
            }
            .buttonStyle(.plain)

            Text("模\n版")
                .font(.caption.weight(.bold))
                .multilineTextAlignment(.center)
                .foregroundStyle(Color.roseText)

            Spacer()

            Button {
                designerSeedTemplate = makeNewTemplate()
                isShowingTemplateDesigner = true
            } label: {
                VStack(spacing: 5) {
                    Image(systemName: "plus")
                        .font(.title3)
                        .foregroundStyle(Color.deepPink)
                        .frame(width: 42, height: 42)
                        .background(.white.opacity(0.84), in: Circle())
                    Text("新建")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Color.roseText)
                }
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 14)
        .background(.white.opacity(0.58), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(.white.opacity(0.85), lineWidth: 1))
    }

    private var templatePicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("CHOOSE YOUR STYLE")
                        .font(.caption2.weight(.bold))
                        .tracking(1.8)
                        .foregroundStyle(Color.deepPink.opacity(0.7))
                    Text("选择模版")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Color.roseText)
                }
                Spacer()
                Button {
                    isTemplatePanelCollapsed = true
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.headline)
                        .frame(width: 34, height: 34)
                        .background(.white.opacity(0.8), in: Circle())
                }
                .buttonStyle(.plain)
            }

            selectedTemplatePreview

            Button {
                designerSeedTemplate = selectedTemplate
                isShowingTemplateDesigner = true
            } label: {
                Label("设计当前模版", systemImage: "paintbrush.pointed.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PillButtonStyle(filled: false))

            Button {
                designerSeedTemplate = makeNewTemplate()
                isShowingTemplateDesigner = true
            } label: {
                Label("新建空白模版", systemImage: "plus.square.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PillButtonStyle(filled: false))

            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 10) {
                    ForEach(availableTemplates) { template in
                        templateRow(template)
                    }
                }
                .padding(.bottom, 4)
            }
        }
        .padding(14)
        .background(.white.opacity(0.58), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26).stroke(.white.opacity(0.85), lineWidth: 1))
    }

    private var selectedTemplatePreview: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("当前预览")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.roseText)
                Spacer()
                Text("\(selectedTemplate.photoCount) 张")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Color.deepPink)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.deepPink.opacity(0.11), in: Capsule())
            }
            Image(uiImage: templatePreviewImage(selectedTemplate))
                .resizable()
                .scaledToFit()
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .shadow(color: .deepPink.opacity(0.12), radius: 12, y: 5)
        }
        .padding(10)
        .background(.white.opacity(0.72), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func templateRow(_ template: BoothTemplate) -> some View {
        Button {
            selectedTemplate = template
            templateID = template.id
            resetSession()
        } label: {
            HStack(spacing: 10) {
                Image(uiImage: templatePreviewImage(template))
                    .resizable()
                    .scaledToFill()
                    .frame(width: 74, height: 50)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(template.name)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(Color.roseText)
                    Text("\(template.height > template.width ? "6寸竖版" : "6寸横版") · \(template.photoCount) 张")
                        .font(.caption)
                        .foregroundStyle(Color.roseText.opacity(0.62))
                }
                Spacer()
                if selectedTemplate.id == template.id {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color.deepPink)
                }
            }
            .padding(9)
            .background(selectedTemplate.id == template.id ? Color.deepPink.opacity(0.12) : Color.white.opacity(0.55), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(selectedTemplate.id == template.id ? Color.deepPink.opacity(0.45) : .white.opacity(0.72)))
        }
        .buttonStyle(.plain)
    }

    private var previewStage: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .fill(Color.white.opacity(0.72))
                .shadow(color: .deepPink.opacity(0.16), radius: 24, y: 10)

            VStack(spacing: 9) {
                HStack {
                    Text("6 INCH · LANDSCAPE")
                        .font(.caption.weight(.bold))
                        .tracking(1.4)
                        .foregroundStyle(Color.deepPink.opacity(0.74))
                        .padding(.horizontal, 13)
                        .padding(.vertical, 7)
                        .background(Color.white.opacity(0.82), in: Capsule())

                    Spacer()

                    if isRunningSession {
                        Text("拍摄 \(max(currentShot, 1)) / \(selectedTemplate.photoCount)")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(Color.deepPink)
                            .padding(.horizontal, 15)
                            .padding(.vertical, 8)
                            .background(Color.white.opacity(0.88), in: Capsule())
                    }
                }

                ZStack {
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(Color(red: 0.99, green: 0.84, blue: 0.90))

                    stageContent

                    if let countdown {
                        Text("\(countdown)")
                            .font(.system(size: 82, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .frame(width: 136, height: 136)
                            .overlay(Circle().stroke(.white, lineWidth: 7))
                            .shadow(color: .deepPink.opacity(0.3), radius: 16, y: 6)
                    }
                }
                .aspectRatio(previewAspect, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 24).stroke(.white, lineWidth: 6))
            }
            .padding(16)
        }
    }

    @ViewBuilder
    private var stageContent: some View {
        if let finalImage {
            Image(uiImage: finalImage)
                .resizable()
                .scaledToFit()
                .padding(8)
        } else if !isRunningSession {
            Image(uiImage: templatePreviewImage(selectedTemplate))
                .resizable()
                .scaledToFit()
                .padding(8)
                .overlay(alignment: .bottom) {
                    Text("点击拍摄前预览模版")
                        .font(.callout.weight(.bold))
                        .foregroundStyle(Color.roseText)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 9)
                        .background(.white.opacity(0.86), in: Capsule())
                        .padding(.bottom, 18)
                }
        } else if let livePreview = camera.livePreview {
            Image(uiImage: livePreview)
                .resizable()
                .scaledToFill()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
        } else if let latest = capturedPhotos.last ?? camera.latestImage {
            Image(uiImage: latest)
                .resizable()
                .scaledToFill()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
        } else {
            VStack(spacing: 12) {
                Text("♡")
                    .font(.system(size: 78, weight: .bold))
                    .foregroundStyle(Color.deepPink)
                Text("留下这一刻")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Color.roseText)
                Text("轻触下方按钮，开始倒数拍摄")
                    .font(.callout)
                    .foregroundStyle(Color.roseText.opacity(0.65))
            }
        }
    }

    private var mainActions: some View {
        HStack(spacing: 12) {
            if finalImage == nil {
                Button {
                    Task { await runCaptureSession() }
                } label: {
                    Label(camera.isCapturing || isRunningSession ? "拍摄中…" : "开始拍照", systemImage: "camera.circle.fill")
                }
                .buttonStyle(PillButtonStyle(filled: true))
                .disabled(!camera.isReady || camera.isCapturing || isRunningSession)
            } else {
                Button("重新拍") { resetSession() }
                    .buttonStyle(PillButtonStyle(filled: false))

                Button {
                    savePhoto()
                } label: {
                    Label("保存照片", systemImage: "square.and.arrow.down.fill")
                }
                .buttonStyle(PillButtonStyle(filled: false))

                Button {
                    isShowingShareSheet = true
                } label: {
                    Label("分享 / AirDrop", systemImage: "square.and.arrow.up.fill")
                }
                .buttonStyle(PillButtonStyle(filled: false))

                Button("AirPrint 打印") { printPhoto() }
                    .buttonStyle(PillButtonStyle(filled: true))
            }
        }
    }

    private var bottomStatus: some View {
        HStack {
            Text(statusMessage.isEmpty ? camera.status : statusMessage)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.roseText.opacity(0.72))
                .lineLimit(1)
            Spacer()
            Text("当前模版：\(selectedTemplate.name) · 需要 \(selectedTemplate.photoCount) 张")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.deepPink.opacity(0.72))
        }
        .padding(.horizontal, 4)
    }

    private var settingsView: some View {
        NavigationView {
            Form {
                Section("活动设置") {
                    TextField("活动名称", text: $eventName, axis: .vertical)
                    DateTextField(title: "活动日期", text: $eventDate)
                    Stepper("倒数秒数：\(countdownSeconds)", value: $countdownSeconds, in: 1...10)
                    TextField("照片文字", text: $message, axis: .vertical)
                        .lineLimit(2...4)
                }

                Section("模版") {
                    Picker("当前模版", selection: $templateID) {
                        ForEach(availableTemplates) { template in
                            Text(template.name).tag(template.id)
                        }
                    }
                    Text("iPad 版目前使用横版 6 寸模板，避免现场需要把相机竖起来。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("PicBooth 设置")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { isShowingSettings = false }
                }
            }
        }
    }

    private func runCaptureSession() async {
        capturedPhotos = []
        finalImage = nil
        countdown = nil
        currentShot = 0
        isRunningSession = true
        statusMessage = ""

        do {
            for index in 0..<selectedTemplate.photoCount {
                currentShot = index + 1
                for value in stride(from: countdownSeconds, through: 1, by: -1) {
                    countdown = value
                    try await Task.sleep(for: .seconds(1))
                }
                countdown = nil
                statusMessage = "正在拍第 \(index + 1) / \(selectedTemplate.photoCount) 张…"
                capturedPhotos.append(try await camera.capture())
                try await Task.sleep(for: .milliseconds(450))
            }

            finalImage = TemplateRenderer.render(
                template: selectedTemplate,
                photos: capturedPhotos,
                event: eventName,
                date: eventDate,
                message: message
            )
            statusMessage = "拍摄完成，可以保存、分享或打印。"
        } catch {
            statusMessage = error.localizedDescription
        }

        countdown = nil
        isRunningSession = false
    }

    private func resetSession() {
        capturedPhotos = []
        finalImage = nil
        countdown = nil
        currentShot = 0
        statusMessage = ""
    }

    private func restoreTemplate() {
        selectedTemplate = availableTemplates.first { $0.id == templateID } ?? BoothTemplate.builtIn[0]
    }

    private var availableTemplates: [BoothTemplate] {
        var templates = BoothTemplate.builtIn
        for custom in decodedCustomTemplates {
            if let index = templates.firstIndex(where: { $0.id == custom.id }) {
                templates[index] = custom
            } else {
                templates.append(custom)
            }
        }
        return templates
    }

    private var decodedCustomTemplates: [BoothTemplate] {
        if let data = customTemplatesJSON.data(using: .utf8),
           let templates = try? JSONDecoder().decode([BoothTemplate].self, from: data) {
            if !templates.isEmpty || legacyCustomTemplateJSON.isEmpty {
                return templates
            }
        }
        if let data = legacyCustomTemplateJSON.data(using: .utf8),
           let template = try? JSONDecoder().decode(BoothTemplate.self, from: data) {
            return [template]
        }
        return []
    }

    private func storeCustomTemplate(_ template: BoothTemplate) {
        var templates = decodedCustomTemplates
        if let index = templates.firstIndex(where: { $0.id == template.id }) {
            templates[index] = template
        } else {
            templates.append(template)
        }
        if let data = try? JSONEncoder().encode(templates) {
            customTemplatesJSON = String(decoding: data, as: UTF8.self)
        }
    }

    private func makeNewTemplate() -> BoothTemplate {
        BoothTemplate(
            id: "custom-\(UUID().uuidString)",
            name: "我的新模版",
            background: "#FFF2F6",
            layers: [
                .photo(
                    id: UUID().uuidString,
                    index: 0,
                    x: 55,
                    y: 55,
                    width: 1320,
                    height: 1090,
                    radius: 30,
                    borderWidth: 10
                ),
                .text(
                    id: UUID().uuidString,
                    value: "{event}",
                    x: 1585,
                    y: 430,
                    size: 48,
                    color: "#A64F6C",
                    font: "script"
                ),
                .text(
                    id: UUID().uuidString,
                    value: "{date}",
                    x: 1585,
                    y: 900,
                    size: 34,
                    color: "#C26D89",
                    font: "elegant"
                )
            ]
        )
    }

    private func templatePreviewImage(_ template: BoothTemplate) -> UIImage {
        TemplateRenderer.render(template: template, photos: [], event: eventName, date: eventDate, message: message)
    }

    private func savePhoto() {
        guard let finalImage else { return }
        UIImageWriteToSavedPhotosAlbum(finalImage, nil, nil, nil)
        statusMessage = "照片已保存到 iPad Photos。"
    }

    private func printPhoto() {
        guard let finalImage else { return }
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .photo
        info.jobName = "PicBooth by KJ"
        info.orientation = .landscape
        controller.printInfo = info
        controller.printingItem = finalImage
        controller.present(animated: true)
    }
}

private struct TemplateDesignerView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var draft: BoothTemplate
    @State private var selectedLayerID: String
    @State private var isImportingImage = false
    @State private var importError = ""

    let eventName: String
    let eventDate: String
    let message: String
    let onSave: (BoothTemplate) -> Void

    init(
        template: BoothTemplate,
        eventName: String,
        eventDate: String,
        message: String,
        onSave: @escaping (BoothTemplate) -> Void
    ) {
        var editable = template
        if !editable.id.hasPrefix("custom-") {
            editable.id = "custom-\(template.id)"
            editable.name = "\(template.name) · 自订"
        }
        _draft = State(initialValue: editable)
        _selectedLayerID = State(initialValue: editable.layers.first?.id ?? "")
        self.eventName = eventName
        self.eventDate = eventDate
        self.message = message
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            HStack(spacing: 18) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("\(draft.height > draft.width ? "6 寸竖版" : "6 寸横版")实时预览")
                        .font(.headline)
                        .foregroundStyle(Color.roseText)
                    Image(uiImage: TemplateRenderer.render(
                        template: draft,
                        photos: [],
                        event: eventName,
                        date: eventDate,
                        message: message
                    ))
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .shadow(color: .deepPink.opacity(0.14), radius: 18, y: 8)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
                .padding(20)

                Form {
                    Section("画布") {
                        TextField("模版名称", text: $draft.name)
                        TextField("背景颜色（例如 #FFF2F6）", text: $draft.background)
                    }

                    Section("图层") {
                        Picker("选择图层", selection: $selectedLayerID) {
                            ForEach(draft.layers) { layer in
                                Text(layerLabel(layer)).tag(layer.id)
                            }
                        }

                        Menu("添加图层") {
                            Button("添加文字") { addTextLayer() }
                            Button("添加爱心") { addHeartLayer() }
                            Button("添加照片框") { addPhotoLayer() }
                        }

                        Button {
                            isImportingImage = true
                        } label: {
                            Label("导入 PNG / JPEG 图片", systemImage: "photo.badge.plus")
                        }
                    }

                    if let binding = selectedLayerBinding {
                        TemplateLayerEditor(layer: binding, canvas: CGSize(width: draft.width, height: draft.height))
                    }
                }
                .frame(width: 390)
            }
            .background(Color(red: 1, green: 0.94, blue: 0.96).ignoresSafeArea())
            .navigationTitle("模版设计器")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存模版") { onSave(draft) }
                        .fontWeight(.bold)
                }
            }
            .fileImporter(
                isPresented: $isImportingImage,
                allowedContentTypes: [.png, .jpeg],
                allowsMultipleSelection: false
            ) { result in
                importImage(result)
            }
            .alert("无法导入图片", isPresented: Binding(
                get: { !importError.isEmpty },
                set: { if !$0 { importError = "" } }
            )) {
                Button("好", role: .cancel) { importError = "" }
            } message: {
                Text(importError)
            }
        }
    }

    private var selectedLayerBinding: Binding<BoothLayer>? {
        guard let index = draft.layers.firstIndex(where: { $0.id == selectedLayerID }) else { return nil }
        return $draft.layers[index]
    }

    private func layerLabel(_ layer: BoothLayer) -> String {
        switch layer.type {
        case .photo: return "照片框 \((layer.photoIndex ?? 0) + 1)"
        case .text: return "文字 · \(layer.text ?? "")"
        case .heart: return "爱心"
        case .image: return "图片"
        }
    }

    private func addTextLayer() {
        let layer = BoothLayer.text(
            id: UUID().uuidString,
            value: "新文字",
            x: draft.width / 2,
            y: draft.height / 2,
            size: 52,
            color: "#A64F6C",
            font: "script"
        )
        draft.layers.append(layer)
        selectedLayerID = layer.id
    }

    private func addHeartLayer() {
        let layer = BoothLayer.heart(
            id: UUID().uuidString,
            x: draft.width / 2,
            y: draft.height / 2,
            width: 100,
            height: 90,
            color: "#D86D93"
        )
        draft.layers.append(layer)
        selectedLayerID = layer.id
    }

    private func addPhotoLayer() {
        let nextIndex = draft.photoCount
        let layer = BoothLayer.photo(
            id: UUID().uuidString,
            index: nextIndex,
            x: 80,
            y: 80,
            width: 900,
            height: 800,
            radius: 20
        )
        draft.layers.append(layer)
        selectedLayerID = layer.id
    }

    private func importImage(_ result: Result<[URL], Error>) {
        do {
            guard let sourceURL = try result.get().first else { return }
            let hasAccess = sourceURL.startAccessingSecurityScopedResource()
            defer {
                if hasAccess { sourceURL.stopAccessingSecurityScopedResource() }
            }

            let folder = try FileManager.default.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            ).appendingPathComponent("PicBoothTemplateAssets", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

            let fileExtension = sourceURL.pathExtension.isEmpty ? "png" : sourceURL.pathExtension
            let destination = folder
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension(fileExtension)
            try FileManager.default.copyItem(at: sourceURL, to: destination)

            guard let image = UIImage(contentsOfFile: destination.path) else {
                throw TemplateImportError.invalidImage
            }

            let maxWidth = draft.width * 0.72
            let maxHeight = draft.height * 0.72
            let scale = min(maxWidth / image.size.width, maxHeight / image.size.height, 1)
            let width = max(80, image.size.width * scale)
            let height = max(80, image.size.height * scale)
            let layer = BoothLayer(
                id: UUID().uuidString,
                type: .image,
                x: (draft.width - width) / 2,
                y: (draft.height - height) / 2,
                w: width,
                h: height,
                src: destination.path,
                opacity: 1
            )
            draft.layers.append(layer)
            selectedLayerID = layer.id
        } catch {
            importError = error.localizedDescription
        }
    }
}

private enum TemplateImportError: LocalizedError {
    case invalidImage

    var errorDescription: String? {
        "所选文件不是可读取的 PNG 或 JPEG 图片。"
    }
}

private struct TemplateLayerEditor: View {
    @Binding var layer: BoothLayer
    let canvas: CGSize

    var body: some View {
        Section("位置与样式") {
            slider("水平位置", value: $layer.x, range: 0...canvas.width)
            slider("垂直位置", value: $layer.y, range: 0...canvas.height)

            if layer.type == .photo || layer.type == .heart || layer.type == .image {
                slider("宽度", value: optionalBinding(\.w, fallback: 400), range: 40...canvas.width)
                slider("高度", value: optionalBinding(\.h, fallback: 300), range: 40...canvas.height)
            }

            if layer.type == .photo {
                slider("圆角", value: optionalBinding(\.radius, fallback: 0), range: 0...120)
                slider("边框", value: optionalBinding(\.borderWidth, fallback: 0), range: 0...30)
                TextField("边框颜色", text: stringBinding(\.borderColor, fallback: "#FFFFFF"))
            }

            if layer.type == .text {
                TextField("文字（可用 {event}、{date}、{text}）", text: stringBinding(\.text, fallback: ""))
                Picker("字体", selection: stringBinding(\.font, fallback: "script")) {
                    Text("艺术手写").tag("script")
                    Text("自然手写").tag("handwritten")
                    Text("优雅衬线").tag("elegant")
                    Text("现代简洁").tag("sans")
                }
                slider("字体大小", value: optionalBinding(\.fontSize, fallback: 52), range: 18...150)
                TextField("文字颜色", text: stringBinding(\.color, fallback: "#A64F6C"))
            }

            if layer.type == .heart {
                TextField("爱心颜色", text: stringBinding(\.color, fallback: "#D86D93"))
            }

            if layer.type == .image {
                slider("透明度", value: optionalBinding(\.opacity, fallback: 1), range: 0.05...1)
            }
        }
    }

    private func slider(_ title: String, value: Binding<CGFloat>, range: ClosedRange<CGFloat>) -> some View {
        VStack(alignment: .leading) {
            Text("\(title)：\(Int(value.wrappedValue))")
                .font(.caption)
            Slider(value: value, in: range)
        }
    }

    private func optionalBinding(_ keyPath: WritableKeyPath<BoothLayer, CGFloat?>, fallback: CGFloat) -> Binding<CGFloat> {
        Binding(
            get: { layer[keyPath: keyPath] ?? fallback },
            set: { layer[keyPath: keyPath] = $0 }
        )
    }

    private func stringBinding(_ keyPath: WritableKeyPath<BoothLayer, String?>, fallback: String) -> Binding<String> {
        Binding(
            get: { layer[keyPath: keyPath] ?? fallback },
            set: { layer[keyPath: keyPath] = $0 }
        )
    }
}

private struct DateTextField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        TextField(title, text: $text)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
    }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

private struct PillButtonStyle: ButtonStyle {
    let filled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.bold))
            .padding(.horizontal, 24)
            .padding(.vertical, 14)
            .foregroundStyle(filled ? .white : Color.deepPink)
            .background(filled ? Color.deepPink : Color.white.opacity(0.72), in: Capsule())
            .overlay(Capsule().stroke(filled ? Color.deepPink : Color.deepPink.opacity(0.28), lineWidth: 1))
            .shadow(color: filled ? Color.deepPink.opacity(0.28) : .clear, radius: 12, y: 6)
            .opacity(configuration.isPressed ? 0.72 : 1)
    }
}

private extension Color {
    static let deepPink = Color(red: 0.83, green: 0.25, blue: 0.47)
    static let roseText = Color(red: 0.45, green: 0.20, blue: 0.30)
}
