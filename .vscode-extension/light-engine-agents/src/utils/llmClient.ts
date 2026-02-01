import * as vscode from 'vscode';

export interface LLMRequest {
    prompt: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
}

export interface LLMResponse {
    content: string;
    model: string;
    tokenCount?: number;
}

/**
 * Client for interacting with VS Code's Language Model API
 * Provides a unified interface for LLM requests with framework-aware prompting
 */
export class LLMClient {
    private static readonly DEFAULT_MODEL_SELECTOR: vscode.LanguageModelChatSelector = {
        vendor: 'copilot',
        family: 'gpt-4'
    };

    /**
     * Send a chat request to the language model
     */
    async chat(request: LLMRequest): Promise<LLMResponse> {
        try {
            const models = await vscode.lm.selectChatModels(LLMClient.DEFAULT_MODEL_SELECTOR);
            
            if (models.length === 0) {
                throw new Error('No language models available. Please ensure GitHub Copilot is active.');
            }

            const model = models[0];
            const messages: vscode.LanguageModelChatMessage[] = [];

            // Add system prompt if provided
            if (request.systemPrompt) {
                messages.push(vscode.LanguageModelChatMessage.Assistant(request.systemPrompt));
            }

            // Add user prompt
            messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

            // Send request with streaming
            const chatRequest = await model.sendRequest(
                messages,
                {
                    justification: 'Light Engine Multi-Agent workflow requires LLM for proposal generation and validation'
                },
                new vscode.CancellationTokenSource().token
            );

            // Collect streaming response
            let content = '';
            for await (const fragment of chatRequest.text) {
                content += fragment;
            }

            return {
                content,
                model: model.id,
                tokenCount: undefined // VS Code API doesn't expose token count yet
            };

        } catch (error) {
            if (error instanceof vscode.LanguageModelError) {
                throw new Error(`LLM Error: ${error.message} (Code: ${error.code})`);
            }
            throw error;
        }
    }

    /**
     * Generate a structured implementation proposal
     */
    async generateProposal(
        task: string,
        relevantFiles: string[],
        existingCode: string[]
    ): Promise<string> {
        const systemPrompt = this.buildImplementationSystemPrompt();
        const prompt = this.buildProposalPrompt(task, relevantFiles, existingCode);

        const response = await this.chat({
            prompt,
            systemPrompt,
            temperature: 0.3, // Lower temperature for more consistent proposals
            maxTokens: 2000
        });

        return response.content;
    }

    /**
     * Generate a review validation response
     */
    async generateReview(
        proposal: string,
        mentionedFiles: string[],
        fileContents: Map<string, string>
    ): Promise<{ approved: boolean; reason: string; issues: string[] }> {
        const systemPrompt = this.buildReviewSystemPrompt();
        const prompt = this.buildReviewPrompt(proposal, mentionedFiles, fileContents);

        const response = await this.chat({
            prompt,
            systemPrompt,
            temperature: 0.2 // Very low temperature for consistent validation
        });

        // Parse the structured response
        return this.parseReviewResponse(response.content);
    }

    /**
     * Generate strategic architecture assessment
     */
    async generateArchitectureAssessment(
        proposal: string,
        task: string
    ): Promise<{ approved: boolean; reason: string; concerns: string[] }> {
        const systemPrompt = this.buildArchitectureSystemPrompt();
        const prompt = this.buildArchitecturePrompt(proposal, task);

        const response = await this.chat({
            prompt,
            systemPrompt,
            temperature: 0.2
        });

        return this.parseArchitectureResponse(response.content);
    }

    // ============= System Prompts =============

    private buildImplementationSystemPrompt(): string {
        return `You are the Implementation Agent in the Light Engine Foxtrot Multi-Agent Framework.

CORE PRINCIPLES:
1. Investigation-First: Always examine existing code before proposing changes
2. Scope-Limited: Define clear boundaries for all changes
3. Verification Required: Provide specific, actionable validation steps
4. Framework Compliance: Follow canonical data formats and standards

YOUR ROLE:
- Propose practical solutions based on actual codebase analysis
- Identify files that need modification or creation
- Specify exact changes with code examples where helpful
- Define verification steps for testing
- Set clear scope limits

OUTPUT FORMAT:
Generate a structured proposal with these sections:
- **Objective**: Clear statement of what will be implemented
- **Investigation Summary**: What you found in the codebase
- **Files to Modify/Create**: Specific file paths with reasons
- **Changes**: Detailed description of modifications
- **Verification Steps**: Checklist for testing
- **Scope Limits**: Boundaries and constraints
- **Framework Compliance**: How this follows the framework rules

CONSTRAINTS:
- Never hallucinate file contents or APIs
- Base all recommendations on provided context
- Flag when you need more information
- Prioritize maintainability over cleverness`;
    }

    private buildReviewSystemPrompt(): string {
        return `You are the Review Agent in the Light Engine Foxtrot Multi-Agent Framework.

YOUR ROLE: Skeptic and Validator (NOT a problem solver)
- Validate scope boundaries and catch scope creep
- Detect hallucinations and unsupported claims
- Verify that mentioned files actually exist
- Check for verification gaps
- Ensure framework compliance

YOU CANNOT:
- Propose alternative solutions
- Suggest improvements or optimizations
- Implement features yourself
- Override scope limits

VALIDATION CHECKLIST:
1. All mentioned files exist and contain referenced code
2. Proposed changes stay within stated scope
3. Verification steps are specific and actionable
4. No unsupported assumptions about file contents
5. Framework rules are followed

OUTPUT FORMAT:
Provide a structured review with:
- **Approval**: APPROVED or REJECTED
- **Reason**: One-sentence summary
- **Issues Found**: List of specific problems (if any)
- **Verification Gaps**: Missing or weak validation steps
- **Scope Assessment**: Within bounds or scope creep detected

Be strict but fair. Approve only when all criteria are met.`;
    }

    private buildArchitectureSystemPrompt(): string {
        return `You are the Architecture Agent in the Light Engine Foxtrot Multi-Agent Framework.

YOUR ROLE: Strategic Guardian
- Assess impact on system architecture
- Validate data format consistency
- Check mission alignment
- Evaluate long-term maintainability
- Flag breaking changes

FOCUS AREAS:
- Data format standards and schemas
- API contracts and interfaces
- Authentication and security
- Database schemas
- Recipe and automation rule structures

OUTPUT FORMAT:
Provide strategic assessment with:
- **Approval**: APPROVED or REJECTED
- **Strategic Impact**: How this affects the system
- **Concerns**: Architectural risks or issues
- **Recommendations**: Strategic guidance (optional)

Approve changes that:
- Maintain data format consistency
- Don't break existing contracts
- Align with system mission
- Follow architectural patterns

Reject changes that:
- Introduce breaking changes without migration plan
- Violate data format standards
- Create technical debt
- Misalign with system goals`;
    }

    // ============= Prompt Builders =============

    private buildProposalPrompt(
        task: string,
        relevantFiles: string[],
        existingCode: string[]
    ): string {
        let prompt = `Task: ${task}\n\n`;

        if (relevantFiles.length > 0) {
            prompt += `Relevant files found in codebase:\n`;
            relevantFiles.forEach(file => prompt += `- ${file}\n`);
            prompt += '\n';
        }

        if (existingCode.length > 0) {
            prompt += `Existing code context:\n`;
            existingCode.forEach((code, idx) => {
                prompt += `\nFile ${relevantFiles[idx] || idx}:\n\`\`\`\n${code}\n\`\`\`\n`;
            });
        }

        prompt += '\nGenerate a detailed implementation proposal following the framework rules.';
        return prompt;
    }

    private buildReviewPrompt(
        proposal: string,
        mentionedFiles: string[],
        fileContents: Map<string, string>
    ): string {
        let prompt = `Proposal to review:\n${proposal}\n\n`;
        
        prompt += `Files mentioned in proposal:\n`;
        mentionedFiles.forEach(file => prompt += `- ${file}\n`);
        prompt += '\n';

        if (fileContents.size > 0) {
            prompt += `Actual file contents:\n`;
            fileContents.forEach((content, file) => {
                prompt += `\nFile: ${file}\n\`\`\`\n${content.substring(0, 1000)}\n\`\`\`\n`;
            });
        }

        prompt += '\nValidate this proposal strictly. Check for hallucinations and scope issues.';
        return prompt;
    }

    private buildArchitecturePrompt(proposal: string, task: string): string {
        return `Task: ${task}\n\nApproved Proposal:\n${proposal}\n\nProvide strategic architecture assessment. Focus on data formats, breaking changes, and system impact.`;
    }

    // ============= Response Parsers =============

    private parseReviewResponse(content: string): { approved: boolean; reason: string; issues: string[] } {
        const approved = content.toLowerCase().includes('approved') && 
                        !content.toLowerCase().includes('rejected');
        
        const issues: string[] = [];
        const issuesMatch = content.match(/issues found:?\s*([\s\S]*?)(?=\n\n|verification gaps|scope assessment|$)/i);
        if (issuesMatch) {
            const issuesList = issuesMatch[1].split('\n').filter(l => l.trim().startsWith('-'));
            issues.push(...issuesList.map(l => l.trim().substring(1).trim()));
        }

        const reasonMatch = content.match(/reason:?\s*(.+?)(?=\n|$)/i);
        const reason = reasonMatch ? reasonMatch[1].trim() : 'See detailed review';

        return { approved, reason, issues };
    }

    private parseArchitectureResponse(content: string): { approved: boolean; reason: string; concerns: string[] } {
        const approved = content.toLowerCase().includes('approved') && 
                        !content.toLowerCase().includes('rejected');
        
        const concerns: string[] = [];
        const concernsMatch = content.match(/concerns:?\s*([\s\S]*?)(?=\n\n|recommendations|$)/i);
        if (concernsMatch) {
            const concernsList = concernsMatch[1].split('\n').filter(l => l.trim().startsWith('-'));
            concerns.push(...concernsList.map(l => l.trim().substring(1).trim()));
        }

        const reasonMatch = content.match(/strategic impact:?\s*(.+?)(?=\n|$)/i);
        const reason = reasonMatch ? reasonMatch[1].trim() : 'See detailed assessment';

        return { approved, reason, concerns };
    }
}
