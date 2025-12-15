export default function Spinner({ size = "md", color = "blue" }) {
    const sizeClasses = {
        sm: "w-4 h-4 border-2",
        md: "w-6 h-6 border-2",
        lg: "w-8 h-8 border-3"
    }

    const colorClasses = {
        blue: "border-blue-600 border-t-transparent",
        white: "border-white border-t-transparent",
        gray: "border-gray-600 border-t-transparent"
    }

    return (
        <div className={`${sizeClasses[size]} ${colorClasses[color]} rounded-full animate-spin`}></div>
    )
}
