import Discord, { ChannelType } from 'discord.js'
import ChildProcess from 'child_process'

const run = async (discord: Discord.Client, channel: Discord.TextChannel, childProcess: ChildProcess.ChildProcess): Promise<void> => {
  let clearLastMessage: () => void
  const sendMessage = (() => {
    const messageQueue: string[] = []
    let isSending = false

    let lastMessage: Discord.Message | undefined
    let lastContent: string = ''
    const toResolves: Array<{ resolve: any, reject: any }> = []
    clearLastMessage = () => {
      lastMessage = undefined
      lastContent = ''
    }

    return async (message: string): Promise<void> => {
      if (message.includes('\n')) {
        for (const line of message.split('\n')) {
          void sendMessage(line)
        }

        return
      }

      if (message.length === 0) {
        return
      }

      console.log(message)
      messageQueue.push(message)
      if (isSending) {
        await new Promise<void>((resolve, reject) => toResolves.push({ resolve, reject }))
        return
      }

      isSending = true
      while (messageQueue.length !== 0) {
        let toBreak = false
        for (let message: string | undefined; (message = messageQueue.shift()) != null;) {
          if ((lastContent.length + message.length + '```text\n```'.length) > 2000) {
            toBreak = true
            break
          }

          lastContent += `${message}\n`
        }

        let retry = 0
        while (true) {
          try {
            const toSend = { content: `\`\`\`text\n${lastContent}\n\`\`\`` }

            if (lastMessage != null) {
              await lastMessage.edit(toSend)
            } else {
              lastMessage = await channel.send(toSend)
            }

            break
          } catch (exception) {
            console.log(exception)
            retry++

            if (retry >= 10) {
              childProcess.kill('SIGINT')
              console.log('Failed to send message')
            }
          } finally {
            await new Promise<void>((resolve) => setTimeout(resolve, 1000))
          }
        }

        if (toBreak) {
          lastMessage = undefined
          lastContent = ''
        }
      }
      isSending = false

      for (let toResolve: any; (toResolve = toResolves.shift()) != null;) {
        toResolve.resolve()
      }
    }
  })()

  const sendCommand = async (message: string): Promise<void> => {
    if (message.length === 0) {
      return
    }

    if (message.includes('\n')) {
      for (const line of message.split('\n')) {
        void sendCommand(line)
      }

      return
    }

    childProcess.stdin?.write(message + '\n')
  }

  childProcess.stdout?.on('data', (buffer) => { void sendMessage(buffer.toString('utf-8')) })
  childProcess.stderr?.on('data', (buffer) => { void sendMessage(buffer.toString('utf-8')) })

  discord.on('messageCreate', (message) => {
    if (
      (message.channel.id !== channel.id) ||
      (message.author.bot)
    ) {
      return
    }

    clearLastMessage()
    console.log(`Discord command: '${message.content.trim()}'`)
    void sendCommand(message.content.trim())
  })

  childProcess.on('exit', (code) => {
    const run = async (): Promise<void> => {
      const message = `Process exited. (code: ${code ?? 'null'})`

      await sendMessage(message)
      discord.destroy()
      process.exit(0)
    }

    void run()
  })

  process.on('SIGINT', () => childProcess.kill('SIGINT'))
  process.stdin.on('data', (data) => {
    void channel.send({ content: `Console command: \`${data.toString('utf-8')}\`` })
    clearLastMessage()

    void sendCommand(data.toString('utf-8'))
  })
}

const init = async (args: string[]): Promise<void> => {
  const discord = new Discord.Client({
    intents: ['Guilds', 'GuildMembers', 'GuildMessages', 'GuildMessageReactions', 'MessageContent']
  })

  await discord.login(process.env.TOKEN)
  const command: string[] = []

  for (const arg of args) {
    command.push(arg.includes(' ') ? `"${arg}"` : arg)
  }

  const childProcess: ChildProcess.ChildProcess = ChildProcess.spawn('/bin/sh', ['-c', command.join(' ').replace('"', '\\"')])

  childProcess.on('spawn', () => {
    const onSpawn = async (): Promise<void> => {
      if (process.env.CHANNEL_ID == null) {
        throw new Error('CHANNEL_ID is not est')
      }
      const channel = await discord.channels.fetch(process.env.CHANNEL_ID)
      if (channel?.type !== ChannelType.GuildText) {
        throw new Error('Invalid target channel.')
      }
      void run(discord, channel, childProcess)
    }

    void onSpawn()
  })
}

void init(process.argv.slice(2))
