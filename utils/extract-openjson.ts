export function extractOpenJson(input: string): string[] {
    // input = String(input).replaceAll(" ", "")
    const regex = /\b(?:in)\s*\(\s*@_(\w+)\s*\)/gi; // Match only after "in" or "openjson"

    const matches: string[] = [];
    let match: RegExpExecArray | null;

    // eslint-disable-next-line no-cond-assign
    while ((match = regex.exec(input)) !== null) {
        matches.push(match[1].replace("@_", "").trim());
    }
    return matches;
}

