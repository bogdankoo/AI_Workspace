const REPLY_DELAY_MS = 500

/**
 * Заглушка вместо реальной модели: держит интерфейс асинхронным,
 * чтобы позже заменить её на вызов LLM без переделки компонентов.
 */
export function getMockReply(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(
        `Это ответ-заглушка. Вы написали: «${prompt}». ` +
          'Подключение реальной модели — следующий шаг роадмапа.',
      )
    }, REPLY_DELAY_MS)
  })
}
