import { Link } from 'react-router-dom'
import styles from './RoleCrumb.module.css'

// The fixed "← roles" breadcrumb present in every role prototype
// (originally <a href="index.html">). Now routes back to the selector.
export default function RoleCrumb() {
  return (
    <Link to="/" className={styles.crumb}>← roles</Link>
  )
}
