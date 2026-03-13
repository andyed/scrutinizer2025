const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const path = require("path");
const fs = require("fs");

async function main() {
    console.log("Starting MCP client test...");
    
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

    // List tools
    const tools = await client.listTools();
    console.log("Tools available:", tools.tools.map(t => t.name));

    // Call capture_vision
    console.log("Calling capture_vision tool for https://example.com (this will take ~6 seconds)");
    const req = await client.callTool({
        name: "capture_vision",
        arguments: {
            url: "https://example.com",
            x: 0.5,
            y: 0.5,
            radius: 200,
            mode: "0"
        }
    });

    if (req.isError) {
        console.error("Error from tool:", req.content[0].text);
    } else {
        const imageBlock = req.content[0];
        if (imageBlock.type === "image") {
            const outPath = path.join(__dirname, "test-output.png");
            fs.writeFileSync(outPath, imageBlock.data, 'base64');
            console.log(`Success! Saved test image to ${outPath}`);
        } else {
            console.log("Unexpected response:", imageBlock);
        }
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
