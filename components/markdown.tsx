import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * rehype-raw is deliberately absent. Without it react-markdown never renders
 * embedded HTML and never touches dangerouslySetInnerHTML, so content written
 * by an API key cannot become script. Adding raw HTML here requires adding
 * sanitisation in the same change.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
