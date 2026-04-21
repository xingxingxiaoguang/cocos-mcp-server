import * as fs from 'fs';
import * as path from 'path';
import { getAgentScriptUrl } from './inject-script';

const MARKER_START = '<!-- COCOS_MCP_INJECT_START -->';
const MARKER_END = '<!-- COCOS_MCP_INJECT_END -->';
const PREVIEW_TEMPLATE_DIR = 'preview-template';
const INJECTION_REGEX = /<!-- COCOS_MCP_INJECT_START -->[\s\S]*?<!-- COCOS_MCP_INJECT_END -->\n?/g;

const DEFAULT_TEMPLATE = `<html>
    <head>
        <link rel="icon" href="./favicon.ico" />
        <meta charset="utf-8" />
        <title><%=title%></title>
        <meta
            name="viewport"
            content="width=device-width,user-scalable=no,initial-scale=1,minimum-scale=1,maximum-scale=1,minimal-ui=true"
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes">
        <meta name="full-screen" content="yes" />
        <meta name="screen-orientation" content="portrait" />
        <meta name="x5-fullscreen" content="true" />
        <meta name="360-fullscreen" content="true" />
        <meta name="renderer" content="webkit" />
        <meta name="force-rendering" content="webkit" />
        <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1" />

        <link rel="stylesheet" type="text/css" href="./index.css" />
    </head>
    <body style="overflow: hidden;">
        <%- include(cocosToolBar, {config: config}) %>
        <div id="content" class="content" style="overflow: hidden;">
            <div class="contentWrap">
                <div id="GameDiv" class="wrapper">
                    <div id="Cocos3dGameContainer">
                        <canvas id="GameCanvas" tabindex="-1" style="background-color: '';"></canvas>
                    </div>
                    <div id="splash">
                        <div class="progress-bar stripes"><span></span></div>
                    </div>
                    <div id="bulletin">
                        <div id="sceneIsEmpty" class="inner"><%=tip_sceneIsEmpty%></div>
                    </div>
                    <div class="error" id="error">
                        <div class="title">Error <i>(Please open the console to see detailed errors)</i></div>
                        <div class="error-main"></div>
                        <div class="error-stack"></div>
                    </div>
                </div>
            </div>
        </div>
        <%- include(cocosTemplate, {}) %>
    </body>
</html>
`;

type InjectResult = { success: boolean; error?: string };

export class PreviewInjector {
    private projectPath: string;
    private injectedPort: number | null = null;

    constructor(projectPath?: string) {
        this.projectPath = projectPath ?? (Editor.Project?.path ?? '');
    }

    inject(port: number): InjectResult {
        if (!this.projectPath) {
            return { success: false, error: 'Project path not available' };
        }

        try {
            const templateDir = this.getTemplateDir();
            let templateFile = this.resolveTemplateFile();
            let content: string;

            if (!templateFile) {
                fs.mkdirSync(templateDir, { recursive: true });
                content = DEFAULT_TEMPLATE;
                templateFile = path.join(templateDir, 'index.ejs');
            } else {
                content = fs.readFileSync(templateFile, 'utf8');
            }

            // Already injected with the same port — no-op
            if (this.hasInjectionMarker(content) && this.injectedPort === port) {
                return { success: true };
            }

            // Strip any existing injection (port changed or stale state)
            content = this.stripExistingInjection(content);

            const block = this.buildInjectionBlock(port);
            content = this.insertBeforeClosingBody(content, block);

            fs.writeFileSync(templateFile, content, 'utf8');
            this.injectedPort = port;

            console.log(`[PreviewInjector] Injected agent script (port ${port}) into ${templateFile}`);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    remove(): InjectResult {
        if (!this.projectPath) {
            return { success: false, error: 'Project path not available' };
        }

        try {
            const templateFile = this.resolveTemplateFile();
            if (!templateFile) {
                return { success: true };
            }

            const content = fs.readFileSync(templateFile, 'utf8');
            if (!this.hasInjectionMarker(content)) {
                return { success: true };
            }

            const cleaned = this.stripExistingInjection(content);

            // If the file is just our default template with no user content, remove the whole directory
            if (cleaned.trim() === DEFAULT_TEMPLATE.trim()) {
                const templateDir = this.getTemplateDir();
                fs.rmSync(templateDir, { recursive: true, force: true });
                console.log('[PreviewInjector] Removed preview-template directory (no user content)');
            } else {
                fs.writeFileSync(templateFile, cleaned, 'utf8');
                console.log('[PreviewInjector] Removed agent injection from preview template');
            }

            this.injectedPort = null;
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    update(port: number): InjectResult {
        this.remove();
        return this.inject(port);
    }

    isInjected(): boolean {
        if (!this.projectPath) return false;
        const templateFile = this.resolveTemplateFile();
        if (!templateFile) return false;
        try {
            const content = fs.readFileSync(templateFile, 'utf8');
            return this.hasInjectionMarker(content);
        } catch {
            return false;
        }
    }

    // ---- Private helpers ----

    private getTemplateDir(): string {
        return path.join(this.projectPath, PREVIEW_TEMPLATE_DIR);
    }

    private resolveTemplateFile(): string | null {
        const dir = this.getTemplateDir();
        if (!fs.existsSync(dir)) return null;

        for (const name of ['index.ejs', 'index.html']) {
            const p = path.join(dir, name);
            if (fs.existsSync(p)) return p;
        }
        return null;
    }

    private hasInjectionMarker(content: string): boolean {
        return content.includes(MARKER_START) && content.includes(MARKER_END);
    }

    private buildInjectionBlock(port: number): string {
        const url = getAgentScriptUrl(port);
        return `\n${MARKER_START}\n<script src="${url}"></script>\n${MARKER_END}\n`;
    }

    private stripExistingInjection(content: string): string {
        return content.replace(INJECTION_REGEX, '');
    }

    private insertBeforeClosingBody(content: string, block: string): string {
        // Insert before </body>
        const bodyMatch = content.lastIndexOf('</body>');
        if (bodyMatch !== -1) {
            return content.slice(0, bodyMatch) + block + content.slice(bodyMatch);
        }

        // Fallback: insert before </head>
        const headMatch = content.lastIndexOf('</head>');
        if (headMatch !== -1) {
            return content.slice(0, headMatch) + block + content.slice(headMatch);
        }

        // Last resort: append to end
        return content + block;
    }
}
