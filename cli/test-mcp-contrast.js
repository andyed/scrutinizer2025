const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const path = require("path");
const fs = require("fs");

const ARTIFACT_DIR = "/Users/andyed/.gemini/antigravity/brain/85678684-b40c-402b-a987-238b17ae3f15";
const URLS = [
    { name: "lukew", url: "https://lukew.com/" },
    { name: "nngroup", url: "https://nngroup.com/" },
    { name: "techmeme", url: "https://techmeme.com/" }
];

async function main() {
    console.log("Starting MCP client test for 3 sites...");
    
    // Setup transport to our local MCP server
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(__dirname, "mcp/server.js")]
    });

    const client = new Client(
        { name: "test-client", version: "1.0.0" },
        { capabilities: {} }
    );

    await client.connect(transport);
    console.log("Connected to MCP server.");

    for (const site of URLS) {
        console.log(`\nCalling capture_vision tool for ${site.url}`);
        const req = await client.callTool({
            name: "capture_vision",
            arguments: {
                url: site.url,
                x: 0.15,
                y: 0.15,
                radius: 180,
                mode: "0"
            }
        });

        if (req.isError) {
            console.error(`Error capturing ${site.name}:`, req.content[0].text);
        } else {
            const imageBlock = req.content[0];
            if (imageBlock.type === "image") {
                const outPath = path.join(ARTIFACT_DIR, `${site.name}.png`);
                fs.writeFileSync(outPath, imageBlock.data, 'base64');
                console.log(`Success! Saved test image to ${outPath}`);
            } else {
                console.log("Unexpected response:", imageBlock);
            }
        }
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
