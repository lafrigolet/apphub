import { Arrow } from './icons.jsx'
import { blogPosts } from '../data/mock.js'

export default function Blog() {
  return (
    <section id="blog" className="relative py-24 sm:py-32 bg-bone border-t border-ink-900/5">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-12">
          <div className="reveal">
            <div className="text-xs uppercase tracking-[0.2em] text-electric-600 font-mono mb-4">— 06 / Recursos</div>
            <h2 className="display text-4xl sm:text-5xl font-semibold leading-[1.02]">Aprende, ahorra, <em>decide mejor</em>.</h2>
          </div>
          <a href="#" className="reveal reveal-delay-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink-900 hover:gap-2.5 transition-all">
            Ver todos los artículos<Arrow />
          </a>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {blogPosts.map((post, idx) => (
            <BlogPost key={post.title} post={post} delay={idx} />
          ))}
        </div>
      </div>
    </section>
  )
}

function BlogPost({ post, delay }) {
  return (
    <article className={`reveal ${delay ? `reveal-delay-${delay}` : ''} group`}>
      <a href="#" className="block rounded-2xl overflow-hidden mb-5 aspect-[4/3] relative">
        <img src={post.img} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
      </a>
      <div className="text-[10px] uppercase tracking-widest text-electric-600 font-mono mb-2">{post.kicker}</div>
      <h3 className="font-display text-xl font-semibold leading-snug mb-2 group-hover:text-electric-700 transition">{post.title}</h3>
      <p className="text-sm text-ink-700">{post.excerpt}</p>
    </article>
  )
}
