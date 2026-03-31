import { useEffect, useRef } from 'react'

export function useAutoScroll(dependency) {
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [dependency])

  return ref
}
