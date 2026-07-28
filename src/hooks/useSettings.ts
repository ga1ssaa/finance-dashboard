export function useSettings(){
    const resetAllData = () => {
        localStorage.clear();

        window.location.reload();
    };

    return{
        resetAllData,
    };
}