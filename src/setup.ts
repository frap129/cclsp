#!/usr/bin/env node

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import inquirer from 'inquirer';
import { scanProjectFiles } from './file-scanner.js';
import { LANGUAGE_SERVERS, generateConfig } from './language-servers.js';

// Runtime detection utilities
async function checkRuntimeAvailability(runtime: string): Promise<boolean> {
  try {
    const result = await runCommandSilent(['which', runtime]);
    return result.success;
  } catch {
    return false;
  }
}

function detectLocalInstallation(): string | null {
  // Check if we're running from a local cclsp installation
  const currentDir = process.cwd();
  const distPath = join(currentDir, 'dist', 'index.js');

  if (existsSync(distPath)) {
    return distPath;
  }

  // Check if we're in the src directory of cclsp
  const parentDistPath = join(dirname(currentDir), 'dist', 'index.js');
  if (existsSync(parentDistPath)) {
    return parentDistPath;
  }

  // Check if we're running the setup command from dist/index.js
  const processPath = process.argv[1];
  if (processPath?.endsWith('dist/index.js')) {
    const setupDistPath = resolve(processPath);
    if (existsSync(setupDistPath)) {
      return setupDistPath;
    }
  }

  return null;
}

async function constructCclspCommand(
  configPath: string
): Promise<{ command: string; description: string }> {
  const localInstallPath = detectLocalInstallation();

  if (!localInstallPath) {
    throw new Error(
      'cclsp must be run from a local repository installation. Please clone the repository and build it with "bun run build".'
    );
  }

  // Local installation detected - determine best runtime
  const bunAvailable = await checkRuntimeAvailability('bun');
  const nodeAvailable = await checkRuntimeAvailability('node');

  if (bunAvailable) {
    return {
      command: `bun run "${localInstallPath}"`,
      description: 'local installation with bun runtime',
    };
  }
  if (nodeAvailable) {
    return {
      command: `node "${localInstallPath}"`,
      description: 'local installation with node runtime',
    };
  }

  throw new Error('No suitable runtime found. Please install Node.js or Bun to run cclsp.');
}

// Detailed installation guides for LSP servers
const DETAILED_INSTALL_GUIDES = {
  typescript: {
    title: 'TypeScript/JavaScript Language Server',
    commands: ['npm install -g typescript-language-server typescript'],
    notes: [
      'Requires Node.js to be installed',
      'The typescript package is also required alongside the language server',
      'Verify installation with: typescript-language-server --version',
    ],
  },
  python: {
    title: 'Python Language Server (pylsp)',
    commands: [
      'pip install "python-lsp-server[all]"',
      '# Or basic installation:',
      'pip install python-lsp-server',
    ],
    notes: [
      'Install with [all] extra for complete feature set including linting, formatting',
      'Available via package managers: brew install python-lsp-server',
      'Verify installation with: pylsp --help',
    ],
  },
  go: {
    title: 'Go Language Server (gopls)',
    commands: ['go install golang.org/x/tools/gopls@latest'],
    notes: [
      'Requires Go 1.21 or later to be installed',
      'Official Go language server maintained by the Go team',
      'Most editors with Go support install gopls automatically',
    ],
  },
  rust: {
    title: 'Rust Language Server (rust-analyzer)',
    commands: ['rustup component add rust-analyzer', 'rustup component add rust-src'],
    notes: [
      'rust-src component is required for standard library support',
      'Alternative: Download prebuilt binaries from GitHub releases',
      'Verify installation: rust-analyzer --version',
    ],
  },
  'c-cpp': {
    title: 'C/C++ Language Server (clangd)',
    commands: [
      '# Ubuntu/Debian:',
      'sudo apt install clangd',
      '# macOS:',
      'brew install llvm',
      '# Windows: Download from LLVM releases',
    ],
    notes: [
      'Part of the LLVM project',
      'Available in most package managers as clangd or clang-tools',
      'Disable other C++ extensions to avoid conflicts',
    ],
  },
  java: {
    title: 'Eclipse JDT Language Server',
    commands: [
      '# Download from Eclipse JDT releases:',
      '# https://download.eclipse.org/jdtls/snapshots/',
    ],
    notes: [
      'Requires Java 11 or higher',
      'Unpack to a directory and add to PATH',
      'Most Java IDEs provide automatic setup',
    ],
  },
  ruby: {
    title: 'Ruby Language Server (Solargraph)',
    commands: ['gem install solargraph'],
    notes: [
      'Requires Ruby to be installed',
      'Additional gems may be needed for full functionality',
      'Verify installation with: solargraph --version',
    ],
  },
  php: {
    title: 'PHP Language Server (Intelephense)',
    commands: ['npm install -g intelephense'],
    notes: [
      'Requires Node.js to be installed',
      'Premium features available with license',
      'Verify installation with: intelephense --version',
    ],
  },
  vue: {
    title: 'Vue.js Language Server (Volar)',
    commands: ['npm install -g @vue/language-server'],
    notes: [
      'Requires Node.js to be installed',
      'Official Vue.js language server with full Vue 3 support',
      'Works with TypeScript and JavaScript',
      'Verify installation with: vue-language-server --version',
    ],
  },
  svelte: {
    title: 'Svelte Language Server',
    commands: ['npm install -g svelte-language-server'],
    notes: [
      'Requires Node.js to be installed',
      'Provides IntelliSense for Svelte components',
      'Works with TypeScript and JavaScript',
      'Verify installation with: svelteserver --help',
    ],
  },
};

// Installation commands for automatic installation
const AUTO_INSTALL_COMMANDS = {
  typescript: ['npm', 'install', '-g', 'typescript-language-server', 'typescript'],
  python: ['pip', 'install', 'python-lsp-server[all]'],
  go: ['go', 'install', 'golang.org/x/tools/gopls@latest'],
  rust: [
    ['rustup', 'component', 'add', 'rust-analyzer'],
    ['rustup', 'component', 'add', 'rust-src'],
  ],
  ruby: ['gem', 'install', 'solargraph'],
  php: ['npm', 'install', '-g', 'intelephense'],
  vue: ['npm', 'install', '-g', '@vue/language-server'],
  svelte: ['npm', 'install', '-g', 'svelte-language-server'],
};

async function runCommand(
  command: string[],
  name: string,
  showInstallingMessage = true
): Promise<boolean> {
  return new Promise((resolve) => {
    if (showInstallingMessage) {
      console.log(`🔄 Installing ${name}...`);
    }
    console.log(`   Running: ${command.join(' ')}`);

    const [cmd, ...args] = command;
    if (!cmd) {
      console.log(`❌ No command specified for ${name}`);
      resolve(false);
      return;
    }

    const process = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'] as const,
      shell: false,
    });

    let output = '';
    let error = '';
    let hasErrored = false;

    process.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    process.stderr?.on('data', (data: Buffer) => {
      error += data.toString();
    });

    process.on('error', (err: NodeJS.ErrnoException) => {
      hasErrored = true;
      console.log(`❌ Failed to install ${name}`);
      console.log(`   Error: ${err.message}`);
      resolve(false);
    });

    process.on('close', (code: number | null) => {
      // Only handle close if we haven't already handled an error
      if (!hasErrored) {
        if (code === 0) {
          console.log(`✅ ${name} installed successfully`);
          resolve(true);
        } else {
          console.log(`❌ Failed to install ${name}`);
          if (error) {
            console.log(`   Error output: ${error.trim()}`);
          }
          if (output) {
            console.log(`   Output: ${output.trim()}`);
          }
          console.log(`   Exit code: ${code}`);
          resolve(false);
        }
      }
    });
  });
}

async function runCommandSilent(
  command: string[]
): Promise<{ success: boolean; output: string; error: string }> {
  return new Promise((resolve) => {
    const [cmd, ...args] = command;
    if (!cmd) {
      resolve({ success: false, output: '', error: 'No command specified' });
      return;
    }

    const process = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'] as const,
      shell: false,
    });

    let output = '';
    let error = '';
    let hasErrored = false;

    process.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    process.stderr?.on('data', (data: Buffer) => {
      error += data.toString();
    });

    process.on('error', (err: NodeJS.ErrnoException) => {
      hasErrored = true;
      resolve({
        success: false,
        output: output.trim(),
        error: err.message,
      });
    });

    process.on('close', (code: number | null) => {
      // Only handle close if we haven't already handled an error
      if (!hasErrored) {
        resolve({
          success: code === 0,
          output: output.trim(),
          error: error.trim(),
        });
      }
    });
  });
}

async function checkExistingCclspMCP(isUser: boolean): Promise<boolean> {
  try {
    // Check if claude command exists, otherwise use local installation
    const { success: claudeExists } = await runCommandSilent(['which', 'claude']);
    const claudeCmd = claudeExists ? 'claude' : join(homedir(), '.claude', 'local', 'claude');

    const scopeFlag = isUser ? '--scope user' : '';
    const listCommand = [claudeCmd, 'mcp', 'list'];
    if (scopeFlag) {
      listCommand.push(scopeFlag);
    }

    const result = await runCommandSilent(listCommand);
    if (!result.success) {
      return false;
    }

    // Check if cclsp is in the output
    return result.output.toLowerCase().includes('cclsp');
  } catch (error) {
    return false;
  }
}

function getUserCommandsPath(): string {
  return join(homedir(), '.claude', 'commands');
}

function getProjectCommandsPath(): string {
  return join(process.cwd(), '.claude', 'commands');
}

function getCommandsPath(isUser: boolean): string {
  return isUser ? getUserCommandsPath() : getProjectCommandsPath();
}

async function checkExistingPrimeLSPCommand(isUser: boolean): Promise<boolean> {
  const commandsPath = getCommandsPath(isUser);
  const primeLspPath = join(commandsPath, 'prime-lsp.md');
  return existsSync(primeLspPath);
}

async function installPrimeLSPCommand(isUser: boolean): Promise<boolean> {
  try {
    // Get source file path (from current project)
    const sourcePath = join(process.cwd(), '.claude', 'commands', 'prime-lsp.md');

    // Check if source file exists
    if (!existsSync(sourcePath)) {
      console.log('❌ Source prime-lsp.md file not found in project .claude/commands directory');
      console.log('   Expected location: .claude/commands/prime-lsp.md');
      return false;
    }

    // Get target path
    const commandsPath = getCommandsPath(isUser);
    const targetPath = join(commandsPath, 'prime-lsp.md');

    // For project installations, check if source and target are the same
    if (!isUser && resolve(sourcePath) === resolve(targetPath)) {
      console.log('✅ prime-lsp command already exists in project .claude/commands');
      console.log(`📁 Located at: ${targetPath}`);
      return true;
    }

    // Create target directory if needed
    mkdirSync(commandsPath, { recursive: true });

    // Read source content and write to target
    const content = readFileSync(sourcePath, 'utf-8');
    writeFileSync(targetPath, content);

    const scope = isUser ? 'user' : 'project';
    console.log(`✅ prime-lsp command installed successfully to ${scope} scope`);
    console.log(`📁 Installed to: ${targetPath}`);
    return true;
  } catch (error) {
    console.log(`❌ Failed to install prime-lsp command: ${error}`);
    return false;
  }
}

async function installLSPServers(servers: (typeof LANGUAGE_SERVERS)[0][]): Promise<void> {
  console.log('\n🚀 Starting LSP server installation...\n');

  let successCount = 0;
  let totalCount = 0;

  for (const server of servers) {
    const commands = AUTO_INSTALL_COMMANDS[server.name as keyof typeof AUTO_INSTALL_COMMANDS];
    if (!commands) {
      console.log(`⚠️  No automatic installation available for ${server.displayName}`);
      console.log(`   Please install manually: ${server.installInstructions}\n`);
      continue;
    }

    if (Array.isArray(commands[0])) {
      // Multiple commands (like rust-analyzer)
      let allSucceeded = true;
      for (const cmd of commands as string[][]) {
        totalCount++;
        const success = await runCommand(cmd, `${server.displayName} (${cmd.join(' ')})`);
        if (success) {
          successCount++;
        } else {
          allSucceeded = false;
        }
      }
      if (allSucceeded) {
        console.log(`🎉 ${server.displayName} installation completed\n`);
      }
    } else {
      // Single command
      totalCount++;
      const success = await runCommand(commands as string[], server.displayName);
      if (success) {
        successCount++;
        console.log('');
      }
    }
  }

  console.log('📊 Installation Summary:');
  console.log(`   ✅ Successful: ${successCount}/${totalCount}`);
  if (successCount < totalCount) {
    console.log(`   ❌ Failed: ${totalCount - successCount}/${totalCount}`);
    console.log('\n💡 For failed installations, please refer to the detailed guides above');
  }
  console.log('');
}

async function main() {
  console.clear();

  // Check for --user flag
  const isUser = process.argv.includes('--user');

  console.log('🚀 cclsp Configuration Generator\n');

  // Ensure we're running from a local installation
  const localInstallPath = detectLocalInstallation();
  if (!localInstallPath) {
    console.error('❌ cclsp must be run from a local repository installation.');
    console.error('Please clone the repository and build it with "bun run build".');
    process.exit(1);
  }

  const bunAvailable = await checkRuntimeAvailability('bun');
  const nodeAvailable = await checkRuntimeAvailability('node');

  if (bunAvailable) {
    console.log('🔧 Local cclsp installation with bun runtime\n');
  } else if (nodeAvailable) {
    console.log('🔧 Local cclsp installation with node runtime\n');
  } else {
    console.error('❌ No suitable runtime found. Please install Node.js or Bun.');
    process.exit(1);
  }

  if (isUser) {
    console.log('👤 User configuration mode\n');
  } else {
    console.log('📁 Project configuration mode (use --user for user config)\n');
  }

  // Scan project files for language detection (only in project mode)
  let recommendedServers: string[] = [];
  if (!isUser) {
    console.log('🔍 Scanning project files for language detection...\n');
    try {
      const projectPath = process.cwd();
      const scanResult = await scanProjectFiles(projectPath, LANGUAGE_SERVERS);
      recommendedServers = scanResult.recommendedServers;

      if (recommendedServers.length > 0) {
        console.log(
          `📝 Detected languages: ${Array.from(scanResult.extensions).sort().join(', ')}`
        );
        console.log(
          `💡 Recommended servers: ${recommendedServers
            .map((name) => LANGUAGE_SERVERS.find((s) => s.name === name)?.displayName)
            .join(', ')}\n`
        );
      } else {
        console.log('📝 No specific languages detected in project\n');
      }
    } catch (error) {
      console.log('⚠️  Could not scan project files, continuing with manual selection\n');
    }
  }

  const { selectedLanguages } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedLanguages',
      message: 'Select the language servers you want to configure:',
      choices: LANGUAGE_SERVERS.map((server) => ({
        name: `${server.displayName} - ${server.description}`,
        value: server.name,
        short: server.displayName,
        checked: recommendedServers.includes(server.name),
      })),
      validate: (input) => {
        if (input.length === 0) {
          return 'Please select at least one language server.';
        }
        return true;
      },
    },
  ]);

  // Show installation instructions for selected languages
  const selectedServers = LANGUAGE_SERVERS.filter((server) =>
    selectedLanguages.includes(server.name)
  );

  if (selectedServers.length > 0) {
    const installRequiredServers = selectedServers.filter(
      (server) => server.installRequired !== false
    );
    const noInstallServers = selectedServers.filter((server) => server.installRequired === false);

    if (installRequiredServers.length > 0) {
      console.log('\n📋 The following LSPs must be installed before using cclsp:\n');
      for (const server of installRequiredServers) {
        console.log(`  • ${server.displayName}`);
        console.log(`    ${server.installInstructions}\n`);
      }
    }

    if (noInstallServers.length > 0) {
      console.log('✨ These language servers work without installation:\n');
      for (const server of noInstallServers) {
        console.log(`  • ${server.displayName} (uses ${server.command[0]})`);
      }
      console.log('');
    }
  }

  const defaultConfigPath = isUser
    ? join(homedir(), '.config', 'claude', 'cclsp.json')
    : join(process.cwd(), '.claude', 'cclsp.json');

  const { configPath } = await inquirer.prompt([
    {
      type: 'input',
      name: 'configPath',
      message: isUser
        ? 'Where should the user configuration file be saved?'
        : 'Where should the project configuration file be saved?',
      default: defaultConfigPath,
      validate: (input) => {
        if (!input.trim()) {
          return 'Please provide a file path.';
        }
        return true;
      },
    },
  ]);

  const { shouldProceed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'shouldProceed',
      message: `Generate ${isUser ? 'user' : 'project'} configuration file at ${configPath}?`,
      default: true,
    },
  ]);

  if (!shouldProceed) {
    console.log('\n❌ Operation cancelled.');
    process.exit(0);
  }

  try {
    const config = generateConfig(selectedLanguages);
    const configJson = JSON.stringify(config, null, 2);

    // Create directory if it doesn't exist
    const configDir = dirname(configPath);
    mkdirSync(configDir, { recursive: true });

    writeFileSync(configPath, configJson);

    console.log(`\n🎉 ${isUser ? 'User' : 'Project'} configuration generated successfully!`);
    console.log(`📁 Configuration saved to: ${configPath}`);
    console.log(`🔧 Selected languages: ${selectedLanguages.join(', ')}`);

    const hasInstallRequired = selectedServers.some((server) => server.installRequired !== false);
    if (hasInstallRequired) {
      console.log('\n⚠️  Please ensure the required LSPs are installed before using cclsp.');
    }

    // Show Claude MCP setup instructions
    const absoluteConfigPath = resolve(configPath);
    const scopeFlag = isUser ? ' --scope user' : '';
    try {
      const { command: cclspCommand, description } =
        await constructCclspCommand(absoluteConfigPath);
      const mcpCommand = `claude mcp add cclsp ${cclspCommand}${scopeFlag} --env CCLSP_CONFIG_PATH=${absoluteConfigPath}`;

      console.log('\n🔗 To use cclsp with Claude Code, add it to your MCP configuration:');
      console.log(mcpCommand);
      console.log(`   Using ${description}`);
    } catch (error) {
      console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }

    const { viewConfig } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'viewConfig',
        message: 'Would you like to see the generated configuration?',
        default: false,
      },
    ]);

    if (viewConfig) {
      console.log('\n📄 Generated configuration:');
      console.log(configJson);
    }

    // Show detailed installation guides for required LSPs
    const selectedInstallRequired = selectedServers.filter(
      (server) => server.installRequired !== false
    );
    if (selectedInstallRequired.length > 0) {
      const { showDetailedGuides } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'showDetailedGuides',
          message:
            'Would you like to see detailed installation guides for the required LSP servers?',
          default: true,
        },
      ]);

      if (showDetailedGuides) {
        console.log(`\n${'='.repeat(60)}`);
        console.log('📚 DETAILED LSP INSTALLATION GUIDES');
        console.log('='.repeat(60));

        for (const server of selectedInstallRequired) {
          const guide =
            DETAILED_INSTALL_GUIDES[server.name as keyof typeof DETAILED_INSTALL_GUIDES];
          if (guide) {
            console.log(`\n🔧 ${guide.title}`);
            console.log('-'.repeat(guide.title.length + 4));

            console.log('\n💻 Installation Commands:');
            for (const command of guide.commands) {
              if (command.startsWith('#')) {
                console.log(`\x1b[90m${command}\x1b[0m`); // Gray color for comments
              } else {
                console.log(`  ${command}`);
              }
            }

            console.log('\n📝 Notes:');
            for (const note of guide.notes) {
              console.log(`  • ${note}`);
            }
            console.log('');
          }
        }

        console.log('='.repeat(60));
        console.log('💡 TIP: Copy and run the installation commands for your platform');
        console.log('='.repeat(60));
      }
    }

    // Ask if user wants to install LSPs automatically
    if (selectedInstallRequired.length > 0) {
      const installableServers = selectedInstallRequired.filter(
        (server) => AUTO_INSTALL_COMMANDS[server.name as keyof typeof AUTO_INSTALL_COMMANDS]
      );

      if (installableServers.length > 0) {
        const { shouldInstall } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldInstall',
            message: `Do you want to install LSPs now? (${installableServers.map((s) => s.displayName).join(', ')})`,
            default: false,
          },
        ]);

        if (shouldInstall) {
          await installLSPServers(installableServers);
        } else {
          console.log('\n💡 You can install LSPs later using the commands shown above.');
        }
      }
    }

    // Ask if user wants to add cclsp to MCP configuration
    const { shouldAddToMCP } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldAddToMCP',
        message: 'Do you want to add cclsp to your Claude MCP configuration now?',
        default: true,
      },
    ]);

    if (shouldAddToMCP) {
      console.log('\n🔄 Configuring cclsp in Claude MCP...');

      try {
        // Check if claude command exists, otherwise use local installation
        const { success: claudeExists } = await runCommandSilent(['which', 'claude']);
        const claudeCmd = claudeExists ? 'claude' : join(homedir(), '.claude', 'local', 'claude');

        if (!claudeExists) {
          console.log(`   Using local Claude installation at ${claudeCmd}`);
        }

        // Check if cclsp already exists
        const cclspExists = await checkExistingCclspMCP(isUser);

        if (cclspExists) {
          console.log('🔍 Found existing cclsp MCP configuration');
          console.log('🗑️ Removing existing cclsp configuration...');

          const scopeFlag = isUser ? '--scope user' : '';
          const removeSuccess = await runCommand(
            [claudeCmd, 'mcp', 'remove', 'cclsp', scopeFlag].filter(Boolean),
            'remove existing cclsp MCP',
            false
          );
          if (!removeSuccess) {
            console.log('⚠️ Failed to remove existing cclsp configuration, continuing with add...');
          }
        }

        console.log('➕ Adding cclsp to Claude MCP configuration...');
        try {
          const { command: cclspCommand, description } =
            await constructCclspCommand(absoluteConfigPath);
          const mcpCommand = `claude mcp add cclsp ${cclspCommand}${scopeFlag} --env CCLSP_CONFIG_PATH=${absoluteConfigPath}`;
          console.log(`   Using ${description}`);

          const mcpArgs = mcpCommand.split(' ').slice(1); // Remove 'claude' from the command
          const success = await runCommand(
            [claudeCmd, ...mcpArgs],
            'cclsp MCP configuration',
            false
          );

          if (success) {
            console.log('🎉 cclsp has been successfully added to your Claude MCP configuration!');
            console.log('\n✨ You can now use cclsp tools in Claude Code:');
            console.log('   • find_definition - Find symbol definitions');
            console.log('   • find_references - Find symbol references');
            console.log('   • rename_symbol - Rename symbols across the codebase');
          } else {
            console.log('\n💡 You can manually add cclsp to your MCP configuration using:');
            console.log(`   ${mcpCommand}`);
          }
        } catch (error) {
          console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`);
          const fallbackCommand = `claude mcp add cclsp node /path/to/cclsp/dist/index.js${scopeFlag} --env CCLSP_CONFIG_PATH=${absoluteConfigPath}`;
          console.log('\n💡 You can manually add cclsp to your MCP configuration using:');
          console.log(`   ${fallbackCommand}`);
          console.log('\nReplace /path/to/cclsp with the actual path to your cclsp repository.');
        }
      } catch (error) {
        console.log(`\n❌ Failed to configure cclsp in MCP: ${error}`);
        const fallbackCommand = `claude mcp add cclsp node /path/to/cclsp/dist/index.js${scopeFlag} --env CCLSP_CONFIG_PATH=${absoluteConfigPath}`;
        console.log('\n💡 You can manually add cclsp to your MCP configuration using:');
        console.log(`   ${fallbackCommand}`);
        console.log('\nReplace /path/to/cclsp with the actual path to your cclsp repository.');
      }
    } else {
      try {
        const { command: cclspCommand } = await constructCclspCommand(absoluteConfigPath);
        const mcpCommand = `claude mcp add cclsp ${cclspCommand}${scopeFlag} --env CCLSP_CONFIG_PATH=${absoluteConfigPath}`;
        console.log('\n💡 You can add cclsp to your MCP configuration later using:');
        console.log(`   ${mcpCommand}`);
      } catch (error) {
        const fallbackCommand = `claude mcp add cclsp node /path/to/cclsp/dist/index.js${scopeFlag} --env CCLSP_CONFIG_PATH=${absoluteConfigPath}`;
        console.log('\n💡 You can add cclsp to your MCP configuration later using:');
        console.log(`   ${fallbackCommand}`);
        console.log('\nReplace /path/to/cclsp with the actual path to your cclsp repository.');
      }
    }

    // Ask if user wants to install the prime-lsp command for AI assistants
    const { shouldInstallPrimeLSP } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldInstallPrimeLSP',
        message: 'Do you want to install the prime-lsp command for AI assistants?',
        default: true,
      },
    ]);

    if (shouldInstallPrimeLSP) {
      // Ask for installation scope
      const { commandScope } = await inquirer.prompt([
        {
          type: 'list',
          name: 'commandScope',
          message: 'Where should the prime-lsp command be installed?',
          choices: [
            {
              name: 'User scope (~/.claude/commands) - Available globally for all projects',
              value: 'user',
              short: 'User scope',
            },
            {
              name: 'Project scope (./.claude/commands) - Available only for this project',
              value: 'project',
              short: 'Project scope',
            },
          ],
          default: isUser ? 'user' : 'project',
        },
      ]);

      const commandIsUser = commandScope === 'user';
      const scopeDescription = commandIsUser
        ? 'user scope (~/.claude/commands)'
        : 'project scope (./.claude/commands)';

      console.log(`\n🤖 Installing prime-lsp command for AI assistants to ${scopeDescription}...`);

      // Check if command already exists in chosen scope
      const primeLspExists = await checkExistingPrimeLSPCommand(commandIsUser);

      // Also check if it exists in the other scope to inform user
      const otherScopeExists = await checkExistingPrimeLSPCommand(!commandIsUser);
      const otherScopeDescription = !commandIsUser
        ? 'user scope (~/.claude/commands)'
        : 'project scope (./.claude/commands)';

      if (otherScopeExists) {
        console.log(`💡 Note: prime-lsp command already exists in ${otherScopeDescription}`);
      }

      if (primeLspExists) {
        console.log(`🔍 Found existing prime-lsp command in ${scopeDescription}`);
        const { shouldOverwrite } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldOverwrite',
            message: `Overwrite existing prime-lsp.md command in ${scopeDescription}?`,
            default: true,
          },
        ]);

        if (!shouldOverwrite) {
          console.log('⏭️  Skipping prime-lsp command installation');
        } else {
          const success = await installPrimeLSPCommand(commandIsUser);
          if (success) {
            console.log('🎉 prime-lsp command updated successfully!');
            console.log('\n✨ AI assistants can now use the comprehensive LSP usage directive:');
            console.log('   • Ensures proper LSP tool usage over manual code inspection');
            console.log('   • Provides mandatory guidelines for accurate code analysis');
            console.log(
              `   • Available ${commandIsUser ? 'globally for all Claude projects' : 'for this project'}`
            );
          } else {
            const commandsPath = getCommandsPath(commandIsUser);
            console.log(
              `\n💡 You can manually copy .claude/commands/prime-lsp.md to ${commandsPath}/`
            );
          }
        }
      } else {
        const success = await installPrimeLSPCommand(commandIsUser);
        if (success) {
          console.log('🎉 prime-lsp command installed successfully!');
          console.log('\n✨ AI assistants can now use the comprehensive LSP usage directive:');
          console.log('   • Ensures proper LSP tool usage over manual code inspection');
          console.log('   • Provides mandatory guidelines for accurate code analysis');
          console.log(
            `   • Available ${commandIsUser ? 'globally for all Claude projects' : 'for this project'}`
          );
        } else {
          const commandsPath = getCommandsPath(commandIsUser);
          console.log(
            `\n💡 You can manually copy .claude/commands/prime-lsp.md to ${commandsPath}/`
          );
        }
      }
    } else {
      console.log('\n💡 You can install the prime-lsp command later by copying:');
      console.log(
        '   For user scope: .claude/commands/prime-lsp.md → ~/.claude/commands/prime-lsp.md'
      );
      console.log(
        '   For project scope: .claude/commands/prime-lsp.md → ./.claude/commands/prime-lsp.md'
      );
    }
  } catch (error) {
    console.error(`\n❌ Failed to write configuration file: ${error}`);
    process.exit(1);
  }

  console.log('\n🎯 Happy coding!');
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n❌ Operation cancelled.');
  process.exit(0);
});

// Export main for use as subcommand from index.js
export { main };
